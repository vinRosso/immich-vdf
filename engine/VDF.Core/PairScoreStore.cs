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

using System.Linq;
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
		public StoredPair(float grayPercent, float aiPercent) {
			GrayPercent = grayPercent;
			AiPercent = aiPercent;
		}

		/// <summary>0–100, or a negative value when the pair is known to be under the 85% floor.</summary>
		public float GrayPercent { get; }
		/// <summary>0–100 when the AI pass ran, otherwise <see cref="float.NaN"/>.</summary>
		public float AiPercent { get; }
		public bool HasAi => !float.IsNaN(AiPercent);
	}

	/// <summary>
	/// Sidecar of pair scores at or above 85% gray, plus AI matches below that floor.
	/// Lives next to <c>ScannedFiles.db</c> and does not change that file's format.
	/// </summary>
	public sealed class PairScoreStore {
		public const float FloorPercent = 85f;
		const string Magic = "VDFPAIR1";

		readonly Dictionary<string, CoveredFile> files = new(StringComparer.Ordinal);
		readonly Dictionary<string, StoredPair> pairs = new(StringComparer.Ordinal);
		readonly object gate = new();

		public string Fingerprint { get; private set; } = "";
		public double CoverageWindowDays { get; private set; }
		/// <summary>True when the covered files were already compared with AI matching on.</summary>
		public bool AiCovered { get; private set; }
		public int Count {
			get { lock (gate) return pairs.Count; }
		}

		public static string MatcherFingerprint(Settings settings) {
			string core = string.Join("|",
				settings.IgnoreBlackPixels,
				settings.IgnoreWhitePixels,
				settings.CompareHorizontallyFlipped,
				settings.UsePHashing,
				settings.CombineGrayscaleAndPHash,
				settings.Threshhold);
			// pHash's per-frame gate is the requested percent, so a percent change is a different score.
			if (settings.UsePHashing || settings.CombineGrayscaleAndPHash)
				return core + "|p:" + settings.Percent.ToString("R");
			return core;
		}

		public static string PairKey(string pathA, string pathB) {
			return string.CompareOrdinal(pathA, pathB) <= 0
				? pathA + "\n" + pathB
				: pathB + "\n" + pathA;
		}

		public bool GrayFlagsMatch(Settings settings) => Fingerprint == MatcherFingerprint(settings);

		public void Clear() {
			lock (gate) {
				files.Clear();
				pairs.Clear();
				Fingerprint = "";
				CoverageWindowDays = 0;
				AiCovered = false;
			}
		}

		public PairCompareAction Decide(FileEntry a, FileEntry b, Settings settings) {
			if (settings.TimeWindowDays > 0 && !TimeWindow.SharesWindow(a.DateCreated, b.DateCreated, settings.TimeWindowDays))
				return PairCompareAction.Skip;
			if (settings.Percent < FloorPercent || !GrayFlagsMatch(settings))
				return PairCompareAction.Compute;

			lock (gate) {
				if (pairs.TryGetValue(PairKey(a.Path, b.Path), out StoredPair row)) {
					bool grayPasses = row.GrayPercent >= settings.Percent;
					if (settings.UseAiMatching && !row.HasAi && !grayPasses)
						return PairCompareAction.ComputeAiOnly;
					return PairCompareAction.UseStored;
				}
				if (IsCovered(a) && IsCovered(b) && SharesCoverageWindow(a, b)) {
					if (settings.UseAiMatching && !AiCovered) return PairCompareAction.ComputeAiOnly;
					return PairCompareAction.Skip;
				}
			}
			return PairCompareAction.Compute;
		}

		public bool TryGet(FileEntry a, FileEntry b, out StoredPair row) {
			lock (gate) return pairs.TryGetValue(PairKey(a.Path, b.Path), out row);
		}

		public void UpsertGray(FileEntry a, FileEntry b, float grayPercent) {
			lock (gate) {
				string key = PairKey(a.Path, b.Path);
				float gray = grayPercent;
				float ai = float.NaN;
				if (pairs.TryGetValue(key, out StoredPair existing)) {
					if (existing.GrayPercent > gray) gray = existing.GrayPercent;
					ai = existing.AiPercent;
				}
				pairs[key] = new StoredPair(gray, ai);
			}
		}

		public void UpsertAi(FileEntry a, FileEntry b, float aiPercent, float? grayPercent = null) {
			lock (gate) {
				string key = PairKey(a.Path, b.Path);
				float gray = grayPercent ?? (pairs.TryGetValue(key, out StoredPair existing) ? existing.GrayPercent : -1f);
				pairs[key] = new StoredPair(gray, aiPercent);
			}
		}

		public bool HasFullLibraryCoverage {
			get { lock (gate) return CoverageWindowDays <= 0 && files.Count > 0; }
		}

		public void MarkCovered(IEnumerable<FileEntry> entries, double windowDays, Settings settings) {
			lock (gate) {
				// A narrower positive window is a subset of a wider one, and of a full
				// library compare. Keep that wider coverage so the next scan reuses it.
				// Window 0 replaces it: that scan compared every remaining pair.
				bool hadFullCoverage = CoverageWindowDays <= 0 && files.Count > 0;
				double previousWindow = CoverageWindowDays;
				files.Clear();
				foreach (FileEntry entry in entries)
					files[entry.Path] = CoveredFile.From(entry);
				Fingerprint = MatcherFingerprint(settings);
				AiCovered = settings.UseAiMatching;
				if (windowDays <= 0)
					CoverageWindowDays = 0;
				else if (hadFullCoverage || previousWindow > windowDays)
					CoverageWindowDays = hadFullCoverage ? 0 : previousWindow;
				else
					CoverageWindowDays = windowDays;
			}
		}

		public void DropMissing(IEnumerable<FileEntry> entries) {
			lock (gate) {
				var keep = new HashSet<string>(entries.Select(entry => entry.Path), StringComparer.Ordinal);
				var stale = pairs.Keys.Where(key => {
					int split = key.IndexOf('\n');
					string left = key[..split];
					string right = key[(split + 1)..];
					return !keep.Contains(left) || !keep.Contains(right);
				}).ToList();
				foreach (string key in stale) pairs.Remove(key);
				var gone = files.Keys.Where(path => !keep.Contains(path)).ToList();
				foreach (string path in gone) files.Remove(path);
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
				var renamed = new List<(string OldPath, string NewPath)>();
				foreach (CoveredFile covered in files.Values.ToList()) {
					if (string.IsNullOrEmpty(covered.OsHash)) continue;
					if (!byHash.TryGetValue(covered.OsHash, out FileEntry? entry)) continue;
					if (entry.Path == covered.Path) continue;
					renamed.Add((covered.Path, entry.Path));
					files.Remove(covered.Path);
					files[entry.Path] = covered.MovedTo(entry);
				}
				if (renamed.Count == 0) return;
				var map = renamed.ToDictionary(item => item.OldPath, item => item.NewPath, StringComparer.Ordinal);
				var rewritten = new Dictionary<string, StoredPair>(StringComparer.Ordinal);
				foreach (var pair in pairs) {
					int split = pair.Key.IndexOf('\n');
					string left = pair.Key[..split];
					string right = pair.Key[(split + 1)..];
					if (map.TryGetValue(left, out string? newLeft)) left = newLeft;
					if (map.TryGetValue(right, out string? newRight)) right = newRight;
					rewritten[PairKey(left, right)] = pair.Value;
				}
				pairs.Clear();
				foreach (var pair in rewritten) pairs[pair.Key] = pair.Value;
			}
		}

		public void Save(string databaseFolder) {
			Directory.CreateDirectory(databaseFolder);
			string path = Path.Combine(databaseFolder, "PairScores.db");
			string temp = path + ".new";
			lock (gate) {
				using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
				using (var writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: false)) {
					writer.Write(Magic);
					writer.Write(Fingerprint ?? "");
					writer.Write(CoverageWindowDays);
					writer.Write(AiCovered);
					writer.Write(files.Count);
					foreach (CoveredFile file in files.Values) {
						writer.Write(file.Path);
						writer.Write(file.Size);
						writer.Write(file.ModifiedTicks);
						writer.Write(file.OsHash ?? "");
					}
					writer.Write(pairs.Count);
					foreach (var pair in pairs) {
						writer.Write(pair.Key);
						writer.Write(pair.Value.GrayPercent);
						writer.Write(pair.Value.HasAi ? pair.Value.AiPercent : float.NaN);
					}
				}
				File.Move(temp, path, overwrite: true);
			}
		}

		public static PairScoreStore Load(string databaseFolder) {
			var store = new PairScoreStore();
			string path = Path.Combine(databaseFolder, "PairScores.db");
			if (!File.Exists(path)) return store;
			try {
				using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
				using var reader = new BinaryReader(stream, Encoding.UTF8, leaveOpen: false);
				if (reader.ReadString() != Magic) return new PairScoreStore();
				store.Fingerprint = reader.ReadString();
				store.CoverageWindowDays = reader.ReadDouble();
				store.AiCovered = reader.ReadBoolean();
				int fileCount = reader.ReadInt32();
				for (int i = 0; i < fileCount; i++) {
					var file = new CoveredFile(reader.ReadString(), reader.ReadInt64(), reader.ReadInt64(), reader.ReadString());
					store.files[file.Path] = file;
				}
				int pairCount = reader.ReadInt32();
				for (int i = 0; i < pairCount; i++)
					store.pairs[reader.ReadString()] = new StoredPair(reader.ReadSingle(), reader.ReadSingle());
				return store;
			}
			catch (Exception) {
				return new PairScoreStore();
			}
		}

		bool SharesCoverageWindow(FileEntry a, FileEntry b) =>
			TimeWindow.SharesWindow(a.DateCreated, b.DateCreated, CoverageWindowDays);

		bool IsCovered(FileEntry entry) {
			if (!files.TryGetValue(entry.Path, out CoveredFile covered)) return false;
			return covered.Size == entry.FileSize && covered.ModifiedTicks == entry.DateModified.Ticks;
		}

		sealed class CoveredFile {
			public CoveredFile(string path, long size, long modifiedTicks, string osHash) {
				Path = path;
				Size = size;
				ModifiedTicks = modifiedTicks;
				OsHash = osHash;
			}

			public string Path { get; }
			public long Size { get; }
			public long ModifiedTicks { get; }
			public string OsHash { get; }

			public static CoveredFile From(FileEntry entry) =>
				new(entry.Path, entry.FileSize, entry.DateModified.Ticks, entry.OsHash ?? "");

			public CoveredFile MovedTo(FileEntry entry) =>
				new(entry.Path, entry.FileSize, entry.DateModified.Ticks, OsHash);
		}
	}
}
