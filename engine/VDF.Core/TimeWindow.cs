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

namespace VDF.Core {
	/// <summary>
	/// Capture-time windows. <c>W &lt;= 0</c> compares the whole library.
	/// Otherwise each core of <c>W</c> days is padded by <see cref="BufferDays"/>
	/// on both sides. The fraction starts near one third and shrinks as <c>W</c> grows.
	/// </summary>
	public static class TimeWindow {
		public const double ScaleDays = 90d;
		public static readonly DateTime Epoch = new(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc);

		public static double BufferDays(double windowDays) {
			if (windowDays <= 0 || double.IsNaN(windowDays) || double.IsInfinity(windowDays)) return 0;
			return (windowDays / 3d) * (ScaleDays / (ScaleDays + windowDays));
		}

		public static bool SharesWindow(DateTime a, DateTime b, double windowDays) {
			if (windowDays <= 0) return true;
			double buffer = BufferDays(windowDays);
			double first = ToEpochDays(a);
			double second = ToEpochDays(b);
			if (first > second) (first, second) = (second, first);
			double span = windowDays + (2d * buffer);
			if (second - first > span + 1e-6) return false;

			long kMax = (long)Math.Floor((first + buffer) / windowDays);
			long kMin = (long)Math.Floor((first - windowDays - buffer) / windowDays);
			for (long k = kMin; k <= kMax; k++) {
				double start = (k * windowDays) - buffer;
				double end = ((k + 1) * windowDays) + buffer;
				if (first >= start && first <= end && second >= start && second <= end) return true;
			}
			return false;
		}

		public static double ToEpochDays(DateTime value) {
			DateTime utc = value.Kind == DateTimeKind.Unspecified
				? DateTime.SpecifyKind(value, DateTimeKind.Utc)
				: value.ToUniversalTime();
			return (utc - Epoch).TotalDays;
		}
	}
}
