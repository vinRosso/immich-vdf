using VDF.Core;
using VDF.Core.Utils;
using Xunit;

namespace VDF.ForkTests;

/// <summary>
/// A compare that starts from saved scores must report exactly what a compare from scratch reports,
/// while looking at far fewer pairs.
/// </summary>
public sealed class IncrementalCompareTests : CompareHarness {
	/// <summary>Singles that match nothing, plus a few duplicate pairs: exact, in the 85 to 96 band, and mirrored.</summary>
	void Library(int singles) {
		for (int i = 0; i < singles; i++)
			Image($"single{i:000}.jpg", Noise(1000 + i));
		byte[] a = Noise(1);
		Image("a1.jpg", a);
		Image("a2.jpg", Perturb(a, 2, 11));
		byte[] b = Noise(2);
		Image("b1.jpg", b);
		Image("b2.jpg", Perturb(b, 40, 12));
		byte[] d = Noise(3);
		Image("d1.jpg", d);
		Image("d2.jpg", Perturb(Mirror(d), 1, 13));
	}

	/// <summary>New files: a copy of an old one, a new mirrored pair, a band match for an old file, and a stranger.</summary>
	void Arrivals() {
		Image("a3.jpg", Perturb(Noise(1), 1, 21));
		byte[] e = Noise(5);
		Image("e1.jpg", e);
		Image("e2.jpg", Perturb(Mirror(e), 1, 22));
		Image("b3.jpg", Perturb(Noise(2), 38, 23));
		Image("new-single.jpg", Noise(9999));
	}

	Settings Gray(float percent = 96, Action<Settings>? tweak = null) =>
		Match(percent, s => {
			s.CompareHorizontallyFlipped = true;
			tweak?.Invoke(s);
		});

	/// <summary>The groups a compare from scratch would report for the library as it is now.</summary>
	RunResult FromScratch(Settings settings) {
		File.Delete(StoreFile);
		return Run(settings);
	}

	[Fact]
	public void NewFilesGiveTheGroupsAFullCompareGivesAndLookAtFarFewerPairs() {
		Library(singles: 60);
		Run(Gray());

		Arrivals();
		RunResult incremental = Run(Gray());
		RunResult full = FromScratch(Gray());

		Assert.Equal(full.Groups, incremental.Groups);
		Assert.Contains(full.Groups, group => group.Contains("a1.jpg") && group.Contains("a3.jpg"));
		Assert.Contains(full.Groups, group => group.Contains("e1.jpg") && group.Contains("[Flipped]"));
		// 71 files: a full compare looks at 2,485 pairs. Only pairs with a new file, and a few stored matches, remain.
		Assert.True(incremental.Pairs < full.Pairs / 4, $"{incremental.Pairs} of {full.Pairs}");
	}

	[Fact]
	public void ANextCompareWithNothingNewLooksAtAlmostNothing() {
		Library(singles: 60);
		RunResult first = Run(Gray());
		RunResult second = Run(Gray());
		Assert.Equal(first.Groups, second.Groups);
		Assert.True(second.Pairs <= 6, $"{second.Pairs} pairs");
		Assert.True(first.Pairs > 2000);
	}

	[Fact]
	public void ALowerPercentUsesTheStoredBandMatches() {
		Library(singles: 40);
		Run(Gray());
		Arrivals();
		RunResult incremental = Run(Gray(90));
		RunResult full = FromScratch(Gray(90));
		Assert.Equal(full.Groups, incremental.Groups);
		Assert.Contains(full.Groups, group => group.Contains("b1.jpg") && group.Contains("b2.jpg"));
		Assert.True(incremental.Pairs < full.Pairs / 2);
	}

	[Fact]
	public void AChangedFileIsScoredAgainAndItsOldMatchesAreNot() {
		Library(singles: 40);
		Run(Gray());
		FileEntry a2 = DatabaseUtilsEntry("a2.jpg");
		a2.grayBytes[0] = Noise(777);
		a2.DateModified = a2.DateModified.AddMinutes(5);

		RunResult incremental = Run(Gray());
		RunResult full = FromScratch(Gray());
		Assert.Equal(full.Groups, incremental.Groups);
		Assert.DoesNotContain(full.Groups, group => group.Contains("a1.jpg"));
	}

	[Fact]
	public void ARemovedFileTakesItsMatchesWithIt() {
		Library(singles: 40);
		Run(Gray());
		DatabaseUtils.Database.Remove(DatabaseUtilsEntry("a1.jpg"));
		RunResult incremental = Run(Gray());
		RunResult full = FromScratch(Gray());
		Assert.Equal(full.Groups, incremental.Groups);
		Assert.DoesNotContain(full.Groups, group => group.Contains("a2.jpg"));
	}

	[Fact]
	public void TheCaptureWindowGivesTheSameGroupsEitherWay() {
		var dates = new Random(3);
		for (int i = 0; i < 50; i++)
			Image($"s{i:00}.jpg", Noise(2000 + i), day.AddDays(dates.Next(0, 60)));
		byte[] a = Noise(1);
		Image("a1.jpg", a, day.AddDays(10));
		Image("a2.jpg", Perturb(a, 2, 11), day.AddDays(12));
		Image("far.jpg", Perturb(a, 2, 12), day.AddDays(50));
		Settings week() => Gray(96, s => s.TimeWindowDays = 7);

		Run(week());
		Image("a3.jpg", Perturb(a, 1, 13), day.AddDays(11));
		Image("late.jpg", Noise(55), day.AddDays(30));
		RunResult incremental = Run(week());
		RunResult full = FromScratch(week());

		Assert.Equal(full.Groups, incremental.Groups);
		Assert.Contains(full.Groups, group => group.Contains("a1.jpg") && group.Contains("a3.jpg"));
		Assert.DoesNotContain(full.Groups, group => group.Contains("far.jpg"));
		Assert.True(incremental.Pairs < full.Pairs);
	}

	[Fact]
	public void AWiderWindowThanTheSavedOneStillComparesEveryNewPair() {
		var dates = new Random(4);
		for (int i = 0; i < 30; i++)
			Image($"s{i:00}.jpg", Noise(3000 + i), day.AddDays(dates.Next(0, 90)));
		byte[] a = Noise(1);
		Image("a1.jpg", a, day.AddDays(1));
		Image("a2.jpg", Perturb(a, 2, 11), day.AddDays(40));

		Run(Gray(96, s => s.TimeWindowDays = 7));
		RunResult widened = Run(Gray(96, s => s.TimeWindowDays = 0));
		RunResult full = FromScratch(Gray(96, s => s.TimeWindowDays = 0));

		Assert.Equal(full.Groups, widened.Groups);
		Assert.Contains(full.Groups, group => group.Contains("a1.jpg") && group.Contains("a2.jpg"));
	}

	[Fact]
	public void AFullCompareAfterANarrowRunStillComparesPairsOutsideTheNarrowWindow() {
		var dates = new Random(6);
		for (int i = 0; i < 30; i++)
			Image($"s{i:00}.jpg", Noise(5000 + i), day.AddDays(dates.Next(0, 90)));
		Run(Gray(96));

		// Both files arrive during a run that only looks at a week, so their pair is not scored.
		byte[] a = Noise(1);
		Image("a1.jpg", a, day.AddDays(1));
		Image("a2.jpg", Perturb(a, 2, 11), day.AddDays(40));
		Run(Gray(96, s => s.TimeWindowDays = 7));

		RunResult afterwards = Run(Gray(96));
		RunResult full = FromScratch(Gray(96));
		Assert.Equal(full.Groups, afterwards.Groups);
		Assert.Contains(full.Groups, group => group.Contains("a1.jpg") && group.Contains("a2.jpg"));
	}

	[Fact]
	public void VideosGiveTheSameGroupsEitherWay() {
		for (int i = 0; i < 40; i++)
			Video($"clip{i:00}.mp4", Noise(4000 + i), 10 + (i % 5));
		byte[] pattern = Noise(6);
		Video("v1.mp4", pattern, 12);
		Video("v2.mp4", Perturb(pattern, 1, 31), 12);
		Run(Gray());

		Video("v3.mp4", Perturb(pattern, 2, 32), 12);
		Video("m1.mp4", Mirror(pattern), 12);
		Video("fresh.mp4", Noise(8888), 11);
		RunResult incremental = Run(Gray());
		RunResult full = FromScratch(Gray());

		Assert.Equal(full.Groups, incremental.Groups);
		Assert.Contains(full.Groups, group => group.Contains("v1.mp4") && group.Contains("v3.mp4"));
		Assert.True(incremental.Pairs < full.Pairs / 2);
	}

	[Fact]
	public void ALargeVideoLibraryUsingDurationBucketsGivesTheSameGroupsEitherWay() {
		var random = new Random(5);
		for (int i = 0; i < ScanEngine.BucketActivationThreshold + 100; i++)
			Video($"c{i:0000}.mp4", Noise(10_000 + i), 5 + random.Next(0, 2500));
		byte[] pattern = Noise(7);
		Video("v1.mp4", pattern, 700);
		Video("v2.mp4", Perturb(pattern, 1, 41), 701);
		Run(Gray(96, s => s.CompareHorizontallyFlipped = false));

		Video("v3.mp4", Perturb(pattern, 2, 42), 700);
		Video("n1.mp4", Noise(77_777), 900);
		RunResult incremental = Run(Gray(96, s => s.CompareHorizontallyFlipped = false));
		RunResult full = FromScratch(Gray(96, s => s.CompareHorizontallyFlipped = false));

		Assert.Equal(full.Groups, incremental.Groups);
		Assert.Contains(full.Groups, group => group.Contains("v1.mp4") && group.Contains("v3.mp4"));
		Assert.True(incremental.Pairs < full.Pairs / 20, $"{incremental.Pairs} of {full.Pairs}");
	}

	[Fact]
	public void TurningTheShortcutOffScoresEveryPair() {
		Library(singles: 40);
		Run(Gray());
		Arrivals();
		RunResult off = Run(Gray(96, s => s.IncrementalCompare = false));
		RunResult full = FromScratch(Gray());
		Assert.Equal(full.Groups, off.Groups);
		Assert.Equal(full.Pairs, off.Pairs);
	}

	[Fact]
	public void PHashRunsNeverTakeTheShortcut() {
		byte[] pattern = Smooth(1);
		for (int i = 0; i < 20; i++)
			Video($"clip{i:00}.mp4", Smooth(10 + i), 10);
		Video("v1.mp4", pattern, 10);
		Video("v2.mp4", Perturb(pattern, 1, 51), 10);
		Settings pHash() => Match(96, s => s.UsePHashing = true);

		RunResult first = Run(pHash());
		RunResult second = Run(pHash());
		Assert.Equal(first.Groups, second.Groups);
		Assert.Equal(first.Pairs, second.Pairs);
	}

	FileEntry DatabaseUtilsEntry(string name) =>
		DatabaseUtils.Database.Single(entry => Path.GetFileName(entry.Path) == name);
}
