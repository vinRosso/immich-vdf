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
using System.Linq;
using VDF.Core.FFTools;

namespace VDF.Core.Utils {
	/// <summary>
	/// Capture dates read from the files themselves, for callers that have no better source. Images use
	/// their EXIF date; HEIC/HEIF and videos use the container's <c>creation_time</c> tag.
	/// </summary>
	public static class CaptureTimeReader {
		/// <summary>Reads one file. False when it has no usable capture date.</summary>
		public static bool TryRead(string path, out DateTime captured) {
			captured = default;
			string extension = Path.GetExtension(path);
			if (FileUtils.ImageExtensions.Any(known => extension.Equals(known, StringComparison.OrdinalIgnoreCase))) {
				if (ExifReader.TryGetDateTaken(path, out captured))
					return true;
				if (!extension.Equals(".heic", StringComparison.OrdinalIgnoreCase) &&
					!extension.Equals(".heif", StringComparison.OrdinalIgnoreCase))
					return false;
			}
			else if (!FileUtils.IsMediaExtension(extension)) {
				return false;
			}
			DateTime? container = FFProbeEngine.GetCreationTime(path);
			if (container is not { } found) return false;
			captured = found;
			return true;
		}

		/// <summary>Reads many files at once. Files without a date are left out of the result.</summary>
		public static Dictionary<string, DateTime> ReadMany(IEnumerable<string> paths, int parallelism, CancellationToken token = default) {
			var found = new ConcurrentDictionary<string, DateTime>(StringComparer.Ordinal);
			var options = new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, parallelism), CancellationToken = token };
			Parallel.ForEach(paths, options, path => {
				if (TryRead(path, out DateTime captured))
					found[path] = captured;
			});
			return new Dictionary<string, DateTime>(found, StringComparer.Ordinal);
		}

		/// <summary>The form used in the JSON files that carry capture dates: ISO 8601, always UTC.</summary>
		public static string ToIso(DateTime value) {
			DateTime clock = value.Kind switch {
				DateTimeKind.Utc => value,
				DateTimeKind.Local => value.ToUniversalTime(),
				_ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
			};
			return clock.ToString("o", CultureInfo.InvariantCulture);
		}

		/// <summary>Reads a JSON object of path to ISO date. Entries that are not dates are skipped.</summary>
		public static Dictionary<string, DateTime> ReadJson(string jsonFile) {
			using var stream = File.OpenRead(jsonFile);
			Dictionary<string, string>? raw = System.Text.Json.JsonSerializer.Deserialize(stream, CoreJsonContext.Default.DictionaryStringString);
			var times = new Dictionary<string, DateTime>(CoreUtils.IsWindows ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal);
			if (raw == null) return times;
			foreach (var pair in raw) {
				if (DateTime.TryParse(pair.Value, CultureInfo.InvariantCulture,
						DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out DateTime parsed))
					times[pair.Key] = DateTime.SpecifyKind(parsed, DateTimeKind.Utc);
			}
			return times;
		}

		public static void WriteJson(string jsonFile, IReadOnlyDictionary<string, DateTime> times) {
			var raw = new Dictionary<string, string>(times.Count, StringComparer.Ordinal);
			foreach (var pair in times) raw[pair.Key] = ToIso(pair.Value);
			using var stream = File.Create(jsonFile);
			System.Text.Json.JsonSerializer.Serialize(stream, raw, CoreJsonContext.Default.DictionaryStringString);
		}
	}
}
