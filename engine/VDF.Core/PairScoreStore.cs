// /*
//     Copyright (C) 2026 0x90d
//     This file is part of VideoDuplicateFinder
//     VideoDuplicateFinder is free software: you can redistribute it and/or modify
//     it under the terms of the GNU Affero General Public License as published by
//     the Free Software Foundation, either version 3 of the License, or
//     (at your option) any later version.
//     VideoDuplicateFinder is distributed in the hope that it will be useful,
//     but WITHOUT ANY WARRANTY without even the implied warranty of
//     MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//     GNU Affero General Public License for more details.
//     You should have received a copy of the GNU Affero General Public License
//     along with VideoDuplicateFinder.  If not, see <http://www.gnu.org/licenses/>.
// */
//

using System.Collections.Concurrent;
using System.Globalization;
using System.Text;

namespace VDF.Core {
	public enum PairCompareAction {
		Compute,
		ComputeAiOnly,
		UseStored,
		Skip,
	}

	public static class PairCompareActions {
		public static bool RequestsGray(PairCompareAction action) => action == PairCompareAction.Compute;
	}

	public readonly struct StoredPair {
		public StoredPair(float grayPercent, float aiPercent, bool flipped = false) {
			GrayPercent = grayPercent;
			AiPercent = aiPercent;
			Flipped = flipped;
		}

		/// <summary>0–100, or a negative value when the pair is known to be under the 85% floor.</summary>
		public float GrayPercent { get; }
		/// <summary>0–100 when the AI pass ran, otherwise <see cref="float.NaN"/>.</summary>
		public float AiPercent { get; }
		/// <summary>True when the best gray score came from the mirrored orientation.</summary>
		public bool Flipped { get; }
		public bool HasAi => !float.IsNaN(AiPercent);

		/// <summary>
		/// The better gray score wins, and a tie stays unmirrored so the result does not depend on
		/// which thread reported first. An AI score replaces the older one; a gray report leaves it.
		/// </summary>
		internal static StoredPair Merge(StoredPair existing, StoredPair incoming) {
			float gray;
			bool flipped;
			if (incoming.GrayPercent > existing.GrayPercent) {
				gray = incoming.GrayPercent;
				flipped = incoming.Flipped;
			}
			else if (incoming.GrayPercent < existing.GrayPercent) {
				gray = existing.GrayPercent;
				flipped = existing.Flipped;
			}
			else {
				gray = existing.GrayPercent;
				flipped = existing.Flipped && incoming.Flipped;
			}
			return new StoredPair(gray, incoming.HasAi ? incoming.AiPercent : existing.AiPercent, flipped);
		}
	}

	/// <summary>
	/// Sidecar of pair scores at or above 85% gray, plus AI matches below that floor.
	/// Lives next to <c>ScannedFiles.db</c> and does not change that file's format.
	/// Pairs are stored by the position of each file in a table of covered files, so a row is
	/// two integers and three numbers rather than two paths.
	/// </summary>
	public sealed class PairScoreStore {
		public const float FloorPercent = 85f;
		const string Magic = "VDFPAIR3";

		readonly List<CoveredFile> table = new();
		readonly Dictionary<string, int> tableIndex = new(StringComparer.Ordinal);
		Dictionary<long, StoredPair> pairs = new();
		readonly object gate = new();

		public string Fingerprint { get; private set; } = "";
		public double CoverageWindowDays { get; private set; }
		/// <summary>True when the covered files were already compared with AI matching on.</summary>
		public bool AiCovered { get; private set; }
		/// <summary>
		/// The AI percent the covered files were compared at. A pair without an AI row is only known to be under
		/// this, so a lower AI percent has to look at those pairs again.
		/// </summary>
		public float AiFloorPercent { get; private set; }
		static readonly float DefaultAiPercent = new Settings().AiPercent;
		public int Count {
			get { lock (gate) return pairs.Count; }
		}

		/// <summary>
		/// Scores are only kept for the grayscale matcher at 85% or above. pHash is cheap enough to
		/// repeat, and a stored pHash verdict would depend on the percent, so those runs bypass the store.
		/// </summary>
		public static bool IsUsable(Settings settings) =>
			settings.Percent >= FloorPercent && !settings.UsePHashing && !settings.CombineGrayscaleAndPHash;

		/// <summary>
		/// Everything that changes a gray score, or that decides which pairs are compared at all.
		/// A pair skipped under one set of gates has no row, so loosening a gate has to start over.
		/// </summary>
		public static string MatcherFingerprint(Settings settings) {
			var invariant = CultureInfo.InvariantCulture;
			return string.Join("|",
				settings.IgnoreBlackPixels,
				settings.IgnoreWhitePixels,
				settings.CompareHorizontallyFlipped,
				settings.ThumbnailCount.ToString(invariant),
				settings.MaxSamplingDurationSeconds.ToString("R", invariant),
				settings.PercentDurationDifference.ToString("R", invariant),
				settings.DurationDifferenceMinSeconds.ToString("R", invariant),
				settings.DurationDifferenceMaxSeconds.ToString("R", invariant),
				((int)settings.FolderMatchMode).ToString(invariant),
				settings.SameFolderDepth.ToString(invariant));
		}

		internal static long Key(int a, int b) =>
			a < b ? ((long)a << 32) | (uint)b : ((long)b << 32) | (uint)a;

		internal static (int First, int Second) Split(long key) => ((int)(key >> 32), (int)(key & 0xFFFFFFFFL));

		public bool GrayFlagsMatch(Settings settings) => Fingerprint == MatcherFingerprint(settings);

		/// <summary>Whether the saved AI coverage reaches down to the AI percent in <paramref name="settings"/>.</summary>
		bool AiCoveredFor(Settings settings) =>
			AiCovered && (!settings.UseAiMatching || settings.AiPercent >= AiFloorPercent);

		float NextAiFloor(Settings settings) =>
			settings.UseAiMatching && AiCoveredFor(settings) ? Math.Max(AiFloorPercent, settings.AiPercent) : settings.AiPercent;

		public void Clear() {
			lock (gate) ClearUnlocked();
		}

		void ClearUnlocked() {
			table.Clear();
			tableIndex.Clear();
			pairs = new Dictionary<long, StoredPair>();
			Fingerprint = "";
			CoverageWindowDays = 0;
			AiCovered = false;
			AiFloorPercent = 0;
		}

		public bool HasFullLibraryCoverage {
			get { lock (gate) return CoverageWindowDays <= 0 && HasCoveredFiles(); }
		}

		// ---- One compare run ------------------------------------------------------------

		/// <summary>
		/// Prepare the lookups for a compare over <paramref name="entries"/>. Each entry gets its list
		/// position as <c>compareIndex</c>, and stored rows are re-keyed to those positions so the hot
		/// loop needs no strings and no lock. The store is emptied first when its settings are stale.
		/// </summary>
		public PairSession BeginCompare(IReadOnlyList<FileEntry> entries, Settings settings) {
			bool usable = IsUsable(settings);
			lock (gate) {
				if (!usable || !GrayFlagsMatch(settings))
					ClearUnlocked();

				var byPath = new Dictionary<string, int>(entries.Count, StringComparer.Ordinal);
				for (int i = 0; i < entries.Count; i++) {
					entries[i].compareIndex = i;
					byPath.TryAdd(entries[i].Path, i);
				}

				var map = new int[table.Count];
				var covered = new bool[entries.Count];
				for (int t = 0; t < table.Count; t++) {
					CoveredFile file = table[t];
					if (!byPath.TryGetValue(file.Path, out int ci)) {
						map[t] = -1;
						continue;
					}
					map[t] = ci;
					if (file.Matches(entries[ci]))
						covered[ci] = true;
				}

				var rows = new ConcurrentDictionary<long, StoredPair>(Environment.ProcessorCount, Math.Max(16, pairs.Count));
				foreach (var pair in pairs) {
					(int first, int second) = Split(pair.Key);
					int a = map[first];
					int b = map[second];
					// A score belongs to the bytes it was computed from. A file that changed since then
					// (size or modified time) has to be compared again, and its old rows are dropped.
					if (a < 0 || b < 0 || !covered[a] || !covered[b]) continue;
					rows[Key(a, b)] = pair.Value;
				}
				return new PairSession(rows, covered, usable, AiCoveredFor(settings), CoverageWindowDays);
			}
		}

		/// <summary>
		/// Keep what a finished compare learned. Files that left the list lose their rows, and the
		/// list becomes the new set of covered files.
		/// </summary>
		public void Commit(PairSession session, IReadOnlyList<FileEntry> entries, double windowDays, Settings settings) {
			lock (gate) {
				if (!session.Usable || session.EntryCount != entries.Count) {
					ClearUnlocked();
					return;
				}
				double window = NextCoverageWindow(windowDays, session.HasUncovered);
				float aiFloor = session.AiCovered && settings.UseAiMatching
					? Math.Max(AiFloorPercent, settings.AiPercent)
					: settings.AiPercent;
				table.Clear();
				tableIndex.Clear();
				for (int i = 0; i < entries.Count; i++) {
					table.Add(CoveredFile.From(entries[i]));
					tableIndex.TryAdd(entries[i].Path, i);
				}
				pairs = new Dictionary<long, StoredPair>(session.Rows);
				Fingerprint = MatcherFingerprint(settings);
				AiCovered = settings.UseAiMatching;
				AiFloorPercent = aiFloor;
				CoverageWindowDays = window;
			}
		}

		/// <summary>Files known only through a score (size -1) are not covered.</summary>
		bool HasCoveredFiles() {
			foreach (CoveredFile file in table)
				if (file.Size >= 0) return true;
			return false;
		}

		/// <summary>
		/// A narrower positive window is a subset of a wider one, and of a full library compare, so the wider coverage
		/// stays when the same files were compared again. A file that was new or changed in this run was only compared
		/// inside this run's window, so claiming more would leave its pairs outside the window unscored for good.
		/// </summary>
		double NextCoverageWindow(double windowDays, bool hadUncovered) {
			// Window 0 replaces it: that scan compared every remaining pair.
			if (windowDays <= 0) return 0;
			if (hadUncovered) return windowDays;
			bool hadFullCoverage = CoverageWindowDays <= 0 && HasCoveredFiles();
			double previousWindow = CoverageWindowDays;
			if (hadFullCoverage || previousWindow > windowDays) return hadFullCoverage ? 0 : previousWindow;
			return windowDays;
		}

		// ---- Lookups by file, for callers that work one pair at a time -------------------

		public PairCompareAction Decide(FileEntry a, FileEntry b, Settings settings) {
			if (settings.TimeWindowDays > 0 && !TimeWindow.SharesWindow(a.CaptureTime, b.CaptureTime, settings.TimeWindowDays))
				return PairCompareAction.Skip;
			if (!IsUsable(settings) || !GrayFlagsMatch(settings))
				return PairCompareAction.Compute;

			lock (gate) {
				if (IsCovered(a) && IsCovered(b)
					&& tableIndex.TryGetValue(a.Path, out int ia) && tableIndex.TryGetValue(b.Path, out int ib)
					&& pairs.TryGetValue(Key(ia, ib), out StoredPair row))
					return PairSession.ActionForRow(row, settings);
				if (IsCovered(a) && IsCovered(b) && TimeWindow.SharesWindow(a.CaptureTime, b.CaptureTime, CoverageWindowDays))
					return PairSession.ActionWhenCovered(AiCoveredFor(settings), settings);
			}
			return PairCompareAction.Compute;
		}

		public bool TryGet(FileEntry a, FileEntry b, out StoredPair row) {
			lock (gate) {
				if (IsCovered(a) && IsCovered(b)
					&& tableIndex.TryGetValue(a.Path, out int ia) && tableIndex.TryGetValue(b.Path, out int ib))
					return pairs.TryGetValue(Key(ia, ib), out row);
			}
			row = default;
			return false;
		}

		public void UpsertGray(FileEntry a, FileEntry b, float grayPercent, bool flipped = false) =>
			Upsert(a, b, new StoredPair(grayPercent, float.NaN, flipped));

		public void UpsertAi(FileEntry a, FileEntry b, float aiPercent) =>
			Upsert(a, b, new StoredPair(-1f, aiPercent));

		void Upsert(FileEntry a, FileEntry b, StoredPair incoming) {
			lock (gate) {
				long key = Key(IndexOf(a), IndexOf(b));
				pairs[key] = pairs.TryGetValue(key, out StoredPair existing) ? StoredPair.Merge(existing, incoming) : incoming;
			}
		}

		/// <summary>A file seen only through a score has no coverage until a compare marks it.</summary>
		int IndexOf(FileEntry entry) {
			if (tableIndex.TryGetValue(entry.Path, out int index)) return index;
			index = table.Count;
			table.Add(new CoveredFile(entry.Path, -1, 0, 0, ""));
			tableIndex[entry.Path] = index;
			return index;
		}

		/// <summary>
		/// Make <paramref name="entries"/> the covered files. Rows that involve any other file are dropped.
		/// </summary>
		public void MarkCovered(IReadOnlyList<FileEntry> entries, double windowDays, Settings settings) {
			lock (gate) {
				bool hadUncovered = false;
				foreach (FileEntry entry in entries) {
					if (!IsCovered(entry)) { hadUncovered = true; break; }
				}
				double window = NextCoverageWindow(windowDays, hadUncovered);
				float aiFloor = NextAiFloor(settings);
				var byPath = new Dictionary<string, int>(entries.Count, StringComparer.Ordinal);
				for (int i = 0; i < entries.Count; i++) byPath.TryAdd(entries[i].Path, i);

				var remap = new int[table.Count];
				for (int t = 0; t < table.Count; t++)
					remap[t] = byPath.TryGetValue(table[t].Path, out int ni) ? ni : -1;
				var kept = new Dictionary<long, StoredPair>();
				foreach (var pair in pairs) {
					(int first, int second) = Split(pair.Key);
					int a = remap[first];
					int b = remap[second];
					if (a >= 0 && b >= 0) kept[Key(a, b)] = pair.Value;
				}

				table.Clear();
				tableIndex.Clear();
				for (int i = 0; i < entries.Count; i++) {
					table.Add(CoveredFile.From(entries[i]));
					tableIndex.TryAdd(entries[i].Path, i);
				}
				pairs = kept;
				Fingerprint = MatcherFingerprint(settings);
				AiCovered = settings.UseAiMatching;
				AiFloorPercent = aiFloor;
				CoverageWindowDays = window;
			}
		}

		/// <summary>Point stored rows at the path VDF relinked for the same bytes.</summary>
		public void Relink(IEnumerable<FileEntry> entries) {
			lock (gate) {
				var byHash = new Dictionary<string, FileEntry>(StringComparer.Ordinal);
				foreach (FileEntry entry in entries) {
					if (!string.IsNullOrEmpty(entry.OsHash))
						byHash[entry.OsHash] = entry;
				}
				for (int t = 0; t < table.Count; t++) {
					CoveredFile covered = table[t];
					if (string.IsNullOrEmpty(covered.OsHash)) continue;
					if (!byHash.TryGetValue(covered.OsHash, out FileEntry? entry)) continue;
					if (entry.Path == covered.Path || tableIndex.ContainsKey(entry.Path)) continue;
					tableIndex.Remove(covered.Path);
					tableIndex[entry.Path] = t;
					table[t] = covered.MovedTo(entry);
				}
			}
		}

		bool IsCovered(FileEntry entry) {
			if (!tableIndex.TryGetValue(entry.Path, out int index)) return false;
			return table[index].Matches(entry);
		}

		// ---- Disk ----------------------------------------------------------------------

		public void Save(string databaseFolder) {
			Directory.CreateDirectory(databaseFolder);
			string path = Path.Combine(databaseFolder, "PairScores.db");
			string temp = path + ".new";
			lock (gate) {
				using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20))
				using (var writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: false)) {
					writer.Write(Magic);
					writer.Write(Fingerprint ?? "");
					writer.Write(CoverageWindowDays);
					writer.Write(AiCovered);
					writer.Write(table.Count);
					foreach (CoveredFile file in table) {
						writer.Write(file.Path);
						writer.Write(file.Size);
						writer.Write(file.ModifiedTicks);
						writer.Write(file.CaptureTicks);
						writer.Write(file.OsHash ?? "");
					}
					writer.Write(pairs.Count);
					foreach (var pair in pairs) {
						(int first, int second) = Split(pair.Key);
						writer.Write(first);
						writer.Write(second);
						writer.Write(pair.Value.GrayPercent);
						writer.Write(pair.Value.HasAi ? pair.Value.AiPercent : float.NaN);
						writer.Write(pair.Value.Flipped);
					}
					// After the rows, so a file saved before this field existed still loads (see Load).
					writer.Write(AiFloorPercent);
				}
				File.Move(temp, path, overwrite: true);
			}
		}

		/// <summary>An unreadable file, or one from an older layout, loads as an empty store and is rebuilt by the next compare.</summary>
		public static PairScoreStore Load(string databaseFolder) {
			string path = Path.Combine(databaseFolder, "PairScores.db");
			if (!File.Exists(path)) return new PairScoreStore();
			try {
				using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 20);
				using var reader = new BinaryReader(stream, Encoding.UTF8, leaveOpen: false);
				if (reader.ReadString() != Magic) return new PairScoreStore();
				var store = new PairScoreStore {
					Fingerprint = reader.ReadString(),
					CoverageWindowDays = reader.ReadDouble(),
					AiCovered = reader.ReadBoolean(),
				};
				int fileCount = reader.ReadInt32();
				for (int i = 0; i < fileCount; i++) {
					var file = new CoveredFile(reader.ReadString(), reader.ReadInt64(), reader.ReadInt64(), reader.ReadInt64(), reader.ReadString());
					store.table.Add(file);
					store.tableIndex.TryAdd(file.Path, i);
				}
				int pairCount = reader.ReadInt32();
				store.pairs = new Dictionary<long, StoredPair>(pairCount);
				for (int i = 0; i < pairCount; i++) {
					int first = reader.ReadInt32();
					int second = reader.ReadInt32();
					if ((uint)first >= (uint)fileCount || (uint)second >= (uint)fileCount)
						return new PairScoreStore();
					float gray = reader.ReadSingle();
					float ai = reader.ReadSingle();
					bool flipped = reader.ReadBoolean();
					store.pairs[Key(first, second)] = new StoredPair(gray, ai, flipped);
				}
				// Files saved before the AI floor was kept used the engine's own AI percent, as the app never changes it.
				store.AiFloorPercent = stream.Position < stream.Length
					? reader.ReadSingle()
					: store.AiCovered ? DefaultAiPercent : 0;
				return store;
			}
			catch (Exception) {
				return new PairScoreStore();
			}
		}

		sealed class CoveredFile {
			public CoveredFile(string path, long size, long modifiedTicks, long captureTicks, string osHash) {
				Path = path;
				Size = size;
				ModifiedTicks = modifiedTicks;
				CaptureTicks = captureTicks;
				OsHash = osHash;
			}

			public string Path { get; }
			public long Size { get; }
			public long ModifiedTicks { get; }
			/// <summary>The date the capture-time window saw for this file. A date edited since then voids its rows.</summary>
			public long CaptureTicks { get; }
			public string OsHash { get; }

			public bool Matches(FileEntry entry) =>
				Size == entry.FileSize && ModifiedTicks == entry.DateModified.Ticks && CaptureTicks == entry.CaptureTime.Ticks;

			public static CoveredFile From(FileEntry entry) =>
				new(entry.Path, entry.FileSize, entry.DateModified.Ticks, entry.CaptureTime.Ticks, entry.OsHash ?? "");

			public CoveredFile MovedTo(FileEntry entry) =>
				new(entry.Path, entry.FileSize, entry.DateModified.Ticks, entry.CaptureTime.Ticks, OsHash);
		}
	}

	/// <summary>
	/// The stored scores for one compare run, keyed by each entry's position in the compare list. Worker
	/// threads read and add scores at the same time; nothing waits on a global lock.
	/// </summary>
	public sealed class PairSession {
		readonly ConcurrentDictionary<long, StoredPair> rows;
		readonly bool[] covered;
		readonly bool aiCovered;
		readonly double coverageWindowDays;

		internal PairSession(ConcurrentDictionary<long, StoredPair> rows, bool[] covered, bool usable, bool aiCovered, double coverageWindowDays) {
			this.rows = rows;
			this.covered = covered;
			Usable = usable;
			this.aiCovered = aiCovered;
			this.coverageWindowDays = coverageWindowDays;
		}

		int[][]? partners;

		/// <summary>False when the matcher settings keep scores from being reused (pHash, or a percent under 85).</summary>
		public bool Usable { get; }

		public bool IsCovered(FileEntry entry) => covered[entry.compareIndex];

		/// <summary>True when a file in the list is new or changed since the saved scores, so this run is its first look at it.</summary>
		internal bool HasUncovered => Array.IndexOf(covered, false) >= 0;

		/// <summary>True when the saved scores include AI scores down to the AI percent of this run.</summary>
		internal bool AiCovered => aiCovered;

		/// <summary>
		/// True when every pair of covered files is either stored or known to be under the floor, so the loops
		/// can leave those pairs alone. That needs the saved window to be the one in use (or the whole library),
		/// and AI scores to have been saved if AI matching is on.
		/// </summary>
		internal bool CanSkipCoveredPairs(Settings settings) {
			if (!Usable) return false;
			if (coverageWindowDays > 0 && coverageWindowDays != settings.TimeWindowDays) return false;
			if (settings.UseAiMatching && !aiCovered) return false;
			foreach (bool isCovered in covered)
				if (isCovered) return true;
			return false;
		}

		/// <summary>
		/// For every covered file, the covered files it may be a duplicate of, according to the stored rows.
		/// Rows that cannot make a match at the current percent are left out. With AI matching on, a row
		/// without an AI score stays in, because that pair still has the AI pass to run.
		/// </summary>
		internal void BuildPartners(Settings settings) {
			var lists = new List<int>?[covered.Length];
			foreach (var row in rows) {
				(int a, int b) = PairScoreStore.Split(row.Key);
				if (!covered[a] || !covered[b]) continue;
				StoredPair value = row.Value;
				bool grayMatches = value.GrayPercent >= settings.Percent;
				bool aiMayMatch = settings.UseAiMatching && (!value.HasAi || value.AiPercent >= settings.AiPercent);
				if (!grayMatches && !aiMayMatch) continue;
				(lists[a] ??= new List<int>()).Add(b);
				(lists[b] ??= new List<int>()).Add(a);
			}
			partners = new int[lists.Length][];
			for (int i = 0; i < lists.Length; i++) {
				partners[i] = lists[i]?.ToArray() ?? Array.Empty<int>();
				Array.Sort(partners[i]);
			}
		}

		/// <summary>Compare indexes of the files <paramref name="entry"/> has a worthwhile stored row with.</summary>
		internal int[] PartnersOf(FileEntry entry) => partners![entry.compareIndex];
		internal int EntryCount => covered.Length;
		internal ConcurrentDictionary<long, StoredPair> Rows => rows;
		public int Count => rows.Count;

		/// <param name="windowChecked">The caller already skipped pairs outside the capture-time window.</param>
		public PairCompareAction Decide(FileEntry a, FileEntry b, Settings settings, bool windowChecked = false) {
			if (!windowChecked && settings.TimeWindowDays > 0 && !TimeWindow.SharesWindow(a.CaptureTime, b.CaptureTime, settings.TimeWindowDays))
				return PairCompareAction.Skip;
			if (!Usable)
				return PairCompareAction.Compute;
			int ia = a.compareIndex;
			int ib = b.compareIndex;
			if (rows.TryGetValue(PairScoreStore.Key(ia, ib), out StoredPair row))
				return ActionForRow(row, settings);
			if (covered[ia] && covered[ib] && (coverageWindowDays <= 0 || TimeWindow.SharesWindow(a.CaptureTime, b.CaptureTime, coverageWindowDays)))
				return ActionWhenCovered(aiCovered, settings);
			return PairCompareAction.Compute;
		}

		public bool TryGet(FileEntry a, FileEntry b, out StoredPair row) =>
			rows.TryGetValue(PairScoreStore.Key(a.compareIndex, b.compareIndex), out row);

		public void RecordGray(FileEntry a, FileEntry b, float grayPercent, bool flipped) {
			if (!Usable) return;
			Record(a, b, new StoredPair(grayPercent, float.NaN, flipped));
		}

		public void RecordAi(FileEntry a, FileEntry b, float aiPercent) {
			if (!Usable) return;
			Record(a, b, new StoredPair(-1f, aiPercent));
		}

		void Record(FileEntry a, FileEntry b, StoredPair incoming) =>
			rows.AddOrUpdate(PairScoreStore.Key(a.compareIndex, b.compareIndex), incoming, (_, existing) => StoredPair.Merge(existing, incoming));

		internal static PairCompareAction ActionForRow(StoredPair row, Settings settings) {
			bool grayPasses = row.GrayPercent >= settings.Percent;
			if (settings.UseAiMatching && !row.HasAi && !grayPasses)
				return PairCompareAction.ComputeAiOnly;
			return PairCompareAction.UseStored;
		}

		/// <summary>Both files were compared before and no row exists, so the pair was under the floor.</summary>
		internal static PairCompareAction ActionWhenCovered(bool aiCovered, Settings settings) =>
			settings.UseAiMatching && !aiCovered ? PairCompareAction.ComputeAiOnly : PairCompareAction.Skip;
	}
}
