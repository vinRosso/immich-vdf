using System.Text;
using VDF.Core;
using Xunit;

namespace VDF.ForkTests;

/// <summary>The pair-score store on its own: fingerprints, the file format and the per-run session.</summary>
public class PairStoreTests {
	static FileEntry Entry(string name, DateTime created, long size = 10) => new() {
		Path = Path.Combine(Path.GetTempPath(), "vdf-fork", name),
		DateCreated = created,
		DateModified = created,
		FileSize = size,
	};

	static Settings Gray(float percent = 96, double windowDays = 0) => new() {
		Percent = percent,
		TimeWindowDays = windowDays,
	};

	[Fact]
	public void TheFingerprintCoversEverythingThatDecidesWhichPairsAreScored() {
		string baseline = PairScoreStore.MatcherFingerprint(Gray());

		Assert.NotEqual(baseline, PairScoreStore.MatcherFingerprint(new Settings { PercentDurationDifference = 40 }));
		Assert.NotEqual(baseline, PairScoreStore.MatcherFingerprint(new Settings { DurationDifferenceMinSeconds = 5 }));
		Assert.NotEqual(baseline, PairScoreStore.MatcherFingerprint(new Settings { DurationDifferenceMaxSeconds = 60 }));
		Assert.NotEqual(baseline, PairScoreStore.MatcherFingerprint(new Settings { ThumbnailCount = 3 }));
		Assert.NotEqual(baseline, PairScoreStore.MatcherFingerprint(new Settings { MaxSamplingDurationSeconds = 120 }));
		Assert.NotEqual(baseline, PairScoreStore.MatcherFingerprint(new Settings { SameFolderDepth = 2 }));
		Assert.NotEqual(baseline, PairScoreStore.MatcherFingerprint(new Settings { FolderMatchMode = (FolderMatchMode)1 }));
		Assert.NotEqual(baseline, PairScoreStore.MatcherFingerprint(new Settings { CompareHorizontallyFlipped = true }));
		Assert.NotEqual(baseline, PairScoreStore.MatcherFingerprint(new Settings { IgnoreBlackPixels = true }));
	}

	[Fact]
	public void SettingsThatDoNotChangeAScoreLeaveTheFingerprintAlone() {
		string baseline = PairScoreStore.MatcherFingerprint(Gray());

		Assert.Equal(baseline, PairScoreStore.MatcherFingerprint(new Settings { Threshhold = 9 }));
		Assert.Equal(baseline, PairScoreStore.MatcherFingerprint(new Settings { Percent = 99 }));
		Assert.Equal(baseline, PairScoreStore.MatcherFingerprint(new Settings { ExcludeHardLinks = true }));
	}

	[Fact]
	public void LoosenedDurationGateStartsOver() {
		var store = new PairScoreStore();
		var strict = new Settings { Percent = 96, PercentDurationDifference = 5 };
		var a = Entry("a.mp4", TimeWindow.Epoch);
		var b = Entry("b.mp4", TimeWindow.Epoch);
		store.MarkCovered(new[] { a, b }, 0, strict);
		Assert.Equal(PairCompareAction.Skip, store.Decide(a, b, strict));

		var loose = new Settings { Percent = 96, PercentDurationDifference = 50 };
		Assert.Equal(PairCompareAction.Compute, store.Decide(a, b, loose));
	}

	[Fact]
	public void PHashAndCombinedMatchingBypassTheStore() {
		var store = new PairScoreStore();
		var a = Entry("a.mp4", TimeWindow.Epoch);
		var b = Entry("b.mp4", TimeWindow.Epoch);
		store.MarkCovered(new[] { a, b }, 0, Gray());
		Assert.Equal(PairCompareAction.Skip, store.Decide(a, b, Gray()));

		var pHash = new Settings { Percent = 96, UsePHashing = true };
		var combined = new Settings { Percent = 96, CombineGrayscaleAndPHash = true };
		Assert.False(PairScoreStore.IsUsable(pHash));
		Assert.False(PairScoreStore.IsUsable(combined));
		Assert.Equal(PairCompareAction.Compute, store.Decide(a, b, pHash));
		Assert.Equal(PairCompareAction.Compute, store.Decide(a, b, combined));

		PairSession session = store.BeginCompare(new[] { a, b }, pHash);
		Assert.False(session.Usable);
		Assert.Equal(PairCompareAction.Compute, session.Decide(a, b, pHash));
		session.RecordGray(a, b, 99, flipped: false);
		Assert.Equal(0, session.Count);

		store.Commit(session, new[] { a, b }, 0, pHash);
		Assert.Equal(0, store.Count);
		Assert.False(store.HasFullLibraryCoverage);
	}

	[Fact]
	public void SavedStoreComesBackWithItsScoresCoverageAndMirrorFlag() {
		string folder = Path.Combine(Path.GetTempPath(), "vdf-pairstore-" + Guid.NewGuid().ToString("N"));
		try {
			var store = new PairScoreStore();
			var settings = new Settings { Percent = 90, CompareHorizontallyFlipped = true, UseAiMatching = true };
			var a = Entry("a.jpg", TimeWindow.Epoch);
			var b = Entry("b.jpg", TimeWindow.Epoch.AddDays(1));
			var c = Entry("c.jpg", TimeWindow.Epoch.AddDays(2));
			a.OsHash = "hash-a";
			store.UpsertGray(a, b, 93.5f, flipped: true);
			store.UpsertAi(a, c, 91f);
			store.MarkCovered(new[] { a, b, c }, 30, settings);
			store.Save(folder);

			PairScoreStore loaded = PairScoreStore.Load(folder);
			Assert.Equal(2, loaded.Count);
			Assert.Equal(30, loaded.CoverageWindowDays);
			Assert.True(loaded.AiCovered);
			Assert.True(loaded.GrayFlagsMatch(settings));
			Assert.True(loaded.TryGet(b, a, out StoredPair mirrored));
			Assert.Equal(93.5f, mirrored.GrayPercent);
			Assert.True(mirrored.Flipped);
			Assert.True(loaded.TryGet(a, c, out StoredPair ai));
			Assert.True(ai.HasAi);
			Assert.Equal(91f, ai.AiPercent);
			Assert.False(ai.Flipped);
			Assert.Equal(PairCompareAction.UseStored, loaded.Decide(a, b, settings));
		}
		finally {
			if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
		}
	}

	[Fact]
	public void ANewFileInANarrowerRunNarrowsTheCoverage() {
		var store = new PairScoreStore();
		var full = Gray(96);
		var a = Entry("a.jpg", TimeWindow.Epoch);
		var b = Entry("b.jpg", TimeWindow.Epoch.AddDays(1));
		store.MarkCovered(new[] { a, b }, 0, full);
		Assert.Equal(0, store.CoverageWindowDays);

		// The same files again: the wider claim stays. A new file: only this run's window is claimed.
		var week = Gray(96, 7);
		store.MarkCovered(new[] { a, b }, 7, week);
		Assert.Equal(0, store.CoverageWindowDays);
		var late = Entry("late.jpg", TimeWindow.Epoch.AddDays(40));
		store.MarkCovered(new[] { a, b, late }, 7, week);
		Assert.Equal(7, store.CoverageWindowDays);
		Assert.Equal(PairCompareAction.Compute, store.Decide(a, late, full));
	}

	[Fact]
	public void ALowerAiPercentLooksAtPairsThatHadNoAiRow() {
		var store = new PairScoreStore();
		var strict = new Settings { Percent = 96, UseAiMatching = true, AiPercent = 94 };
		var a = Entry("a.jpg", TimeWindow.Epoch);
		var b = Entry("b.jpg", TimeWindow.Epoch);
		store.MarkCovered(new[] { a, b }, 0, strict);
		Assert.Equal(94f, store.AiFloorPercent);
		Assert.Equal(PairCompareAction.Skip, store.Decide(a, b, strict));
		Assert.Equal(PairCompareAction.Skip, store.Decide(a, b, new Settings { Percent = 96, UseAiMatching = true, AiPercent = 97 }));

		var loose = new Settings { Percent = 96, UseAiMatching = true, AiPercent = 80 };
		Assert.Equal(PairCompareAction.ComputeAiOnly, store.Decide(a, b, loose));
		PairSession session = store.BeginCompare(new[] { a, b }, loose);
		Assert.False(session.AiCovered);
		Assert.False(session.CanSkipCoveredPairs(loose));

		store.Commit(session, new[] { a, b }, 0, loose);
		Assert.Equal(80f, store.AiFloorPercent);
		Assert.Equal(PairCompareAction.Skip, store.Decide(a, b, loose));
	}

	[Fact]
	public void TheAiFloorIsSavedAndALaterHigherPercentKeepsTheOlderFloor() {
		string folder = Path.Combine(Path.GetTempPath(), "vdf-pairstore-" + Guid.NewGuid().ToString("N"));
		try {
			var store = new PairScoreStore();
			var a = Entry("a.jpg", TimeWindow.Epoch);
			var b = Entry("b.jpg", TimeWindow.Epoch);
			store.MarkCovered(new[] { a, b }, 0, new Settings { Percent = 96, UseAiMatching = true, AiPercent = 90 });
			store.Save(folder);

			PairScoreStore loaded = PairScoreStore.Load(folder);
			Assert.Equal(90f, loaded.AiFloorPercent);
			var higher = new Settings { Percent = 96, UseAiMatching = true, AiPercent = 95 };
			loaded.MarkCovered(new[] { a, b }, 0, higher);
			Assert.Equal(95f, loaded.AiFloorPercent);
		}
		finally {
			if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
		}
	}

	[Fact]
	public void AnOlderOrDamagedFileLoadsAsAnEmptyStore() {
		string folder = Path.Combine(Path.GetTempPath(), "vdf-pairstore-" + Guid.NewGuid().ToString("N"));
		try {
			Directory.CreateDirectory(folder);
			string file = Path.Combine(folder, "PairScores.db");

			using (var writer = new BinaryWriter(File.Create(file), Encoding.UTF8)) {
				writer.Write("VDFPAIR1");
				writer.Write("fingerprint");
			}
			Assert.Equal(0, PairScoreStore.Load(folder).Count);
			Assert.False(PairScoreStore.Load(folder).HasFullLibraryCoverage);

			File.WriteAllBytes(file, new byte[] { 1, 2, 3 });
			Assert.Equal(0, PairScoreStore.Load(folder).Count);
		}
		finally {
			if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
		}
	}

	[Fact]
	public void ARowThatPointsOutsideTheFileTableIsRefused() {
		string folder = Path.Combine(Path.GetTempPath(), "vdf-pairstore-" + Guid.NewGuid().ToString("N"));
		try {
			Directory.CreateDirectory(folder);
			using (var writer = new BinaryWriter(File.Create(Path.Combine(folder, "PairScores.db")), Encoding.UTF8)) {
				writer.Write("VDFPAIR2");
				writer.Write(PairScoreStore.MatcherFingerprint(Gray()));
				writer.Write(0d);
				writer.Write(false);
				writer.Write(1);
				writer.Write("only-file");
				writer.Write(10L);
				writer.Write(10L);
				writer.Write("");
				writer.Write(1);
				writer.Write(0);
				writer.Write(7);
				writer.Write(95f);
				writer.Write(float.NaN);
				writer.Write(false);
			}
			Assert.Equal(0, PairScoreStore.Load(folder).Count);
		}
		finally {
			if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
		}
	}

	[Fact]
	public void TheSavedFileNeedsFarLessSpaceThanPathKeyedRows() {
		string folder = Path.Combine(Path.GetTempPath(), "vdf-pairstore-" + Guid.NewGuid().ToString("N"));
		try {
			var entries = Enumerable.Range(0, 200)
				.Select(i => Entry($"library/2024/holiday/IMG_{i:0000}.jpg", TimeWindow.Epoch.AddDays(i % 7)))
				.ToList();
			var store = new PairScoreStore();
			int rows = 0;
			for (int i = 0; i < entries.Count; i++)
				for (int j = i + 1; j < entries.Count; j += 3) {
					store.UpsertGray(entries[i], entries[j], 90f);
					rows++;
				}
			store.MarkCovered(entries, 0, Gray(90));
			store.Save(folder);

			long size = new FileInfo(Path.Combine(folder, "PairScores.db")).Length;
			long pathKeyed = rows * (2L * entries[0].Path.Length + 12);
			Assert.True(size < pathKeyed / 3, $"{size} bytes for {rows} rows");
		}
		finally {
			if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
		}
	}

	[Fact]
	public void RelinkKeepsScoresForAFileThatMoved() {
		var store = new PairScoreStore();
		var settings = Gray();
		var a = Entry("a.jpg", TimeWindow.Epoch);
		var b = Entry("b.jpg", TimeWindow.Epoch);
		a.OsHash = "same-bytes";
		store.UpsertGray(a, b, 92);
		store.MarkCovered(new[] { a, b }, 0, settings);

		var moved = Entry("elsewhere/a.jpg", TimeWindow.Epoch);
		moved.OsHash = "same-bytes";
		store.Relink(new[] { moved, b });

		Assert.True(store.TryGet(moved, b, out StoredPair row));
		Assert.Equal(92f, row.GrayPercent);
		Assert.Equal(PairCompareAction.UseStored, store.Decide(moved, b, settings));
		Assert.False(store.TryGet(a, b, out _));
	}

	[Fact]
	public void BetterScoreWinsAndATieStaysUnmirroredWhateverTheOrder() {
		var mirrored = new StoredPair(94f, float.NaN, flipped: true);
		var plain = new StoredPair(94f, float.NaN, flipped: false);
		var better = new StoredPair(95f, float.NaN, flipped: true);
		var ai = new StoredPair(-1f, 91f);

		Assert.False(StoredPair.Merge(mirrored, plain).Flipped);
		Assert.False(StoredPair.Merge(plain, mirrored).Flipped);
		Assert.True(StoredPair.Merge(plain, better).Flipped);
		Assert.Equal(95f, StoredPair.Merge(better, plain).GrayPercent);
		StoredPair both = StoredPair.Merge(StoredPair.Merge(better, ai), plain);
		Assert.Equal(95f, both.GrayPercent);
		Assert.True(both.Flipped);
		Assert.Equal(91f, both.AiPercent);
	}

	[Fact]
	public void ThreadsReportingTheSamePairEndWithTheSameRow() {
		var store = new PairScoreStore();
		var settings = Gray();
		var entries = new[] { Entry("a.jpg", TimeWindow.Epoch), Entry("b.jpg", TimeWindow.Epoch) };
		for (int round = 0; round < 20; round++) {
			PairSession session = store.BeginCompare(entries, settings);
			Parallel.For(0, 400, i => session.RecordGray(entries[0], entries[1], 90f + (i % 5), flipped: i % 2 == 0));
			Assert.True(session.TryGet(entries[0], entries[1], out StoredPair row));
			// 94 is reported by even and odd workers alike, so the unmirrored report wins the tie.
			Assert.Equal(94f, row.GrayPercent);
			Assert.False(row.Flipped);
			Assert.Equal(1, session.Count);
		}
	}

	[Fact]
	public void SessionDecidesLikeTheStoreForEveryPair() {
		var dates = new Random(7);
		var entries = Enumerable.Range(0, 14)
			.Select(i => Entry($"f{i}.jpg", TimeWindow.Epoch.AddDays(dates.Next(0, 90)), size: 10 + (i % 3)))
			.ToList();
		var settingsList = new[] {
			Gray(96), Gray(90), Gray(98, 7), Gray(96, 30), Gray(96, 0),
			new Settings { Percent = 96, UseAiMatching = true },
			new Settings { Percent = 96, UseAiMatching = true, TimeWindowDays = 7 },
		};

		// Building the store again for every settings variant keeps BeginCompare, which empties a
		// store that no longer fits the settings, from changing what the next variant sees.
		(PairScoreStore Store, FileEntry? Changed) Build(int seed) {
			var random = new Random(seed);
			var store = new PairScoreStore();
			var built = settingsList[random.Next(settingsList.Length)];
			var covered = entries.Where(_ => random.NextDouble() < 0.7).ToList();
			foreach (FileEntry a in covered)
				foreach (FileEntry b in covered)
					if (string.CompareOrdinal(a.Path, b.Path) < 0 && random.NextDouble() < 0.25) {
						store.UpsertGray(a, b, 85f + (float)(random.NextDouble() * 14), flipped: random.NextDouble() < 0.3);
						if (random.NextDouble() < 0.3) store.UpsertAi(a, b, 80f + (float)(random.NextDouble() * 19));
					}
			store.MarkCovered(covered, random.Next(2) == 0 ? 0 : 30, built);
			// A file that changed since the last compare is not covered any more.
			FileEntry? changed = covered.Count > 0 ? covered[0] : null;
			if (changed != null) changed.FileSize += 5;
			return (store, changed);
		}

		int compared = 0;
		for (int seed = 0; seed < 12; seed++) {
			foreach (Settings now in settingsList) {
				(PairScoreStore store, FileEntry? changed) = Build(seed);
				try {
					PairSession session = store.BeginCompare(entries, now);
					foreach (FileEntry a in entries)
						foreach (FileEntry b in entries) {
							if (ReferenceEquals(a, b)) continue;
							Assert.Equal(store.Decide(a, b, now), session.Decide(a, b, now));
							compared++;
						}
				}
				finally {
					if (changed != null) changed.FileSize -= 5;
				}
			}
		}
		Assert.True(compared > 5000);
	}
}
