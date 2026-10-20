using System.Text;
using VDF.Core;
using VDF.Core.Utils;
using Xunit;

namespace VDF.ForkTests;

public class CaptureTimeTests {
	/// <summary>A TIFF file whose Exif block holds DateTimeOriginal. Little-endian, 64 bytes.</summary>
	static byte[] TiffWithDate(string exifDate) {
		var bytes = new List<byte>();
		bytes.AddRange(new byte[] { 0x49, 0x49, 0x2A, 0x00 });
		bytes.AddRange(BitConverter.GetBytes(8u));
		// IFD0 at 8: one entry, the pointer to the Exif IFD at 26.
		bytes.AddRange(BitConverter.GetBytes((ushort)1));
		bytes.AddRange(BitConverter.GetBytes((ushort)0x8769));
		bytes.AddRange(BitConverter.GetBytes((ushort)4));
		bytes.AddRange(BitConverter.GetBytes(1u));
		bytes.AddRange(BitConverter.GetBytes(26u));
		bytes.AddRange(BitConverter.GetBytes(0u));
		// Exif IFD at 26: DateTimeOriginal, 20 ASCII bytes stored at 44.
		bytes.AddRange(BitConverter.GetBytes((ushort)1));
		bytes.AddRange(BitConverter.GetBytes((ushort)0x9003));
		bytes.AddRange(BitConverter.GetBytes((ushort)2));
		bytes.AddRange(BitConverter.GetBytes(20u));
		bytes.AddRange(BitConverter.GetBytes(44u));
		bytes.AddRange(BitConverter.GetBytes(0u));
		bytes.AddRange(Encoding.ASCII.GetBytes(exifDate.PadRight(19)[..19]));
		bytes.Add(0);
		return bytes.ToArray();
	}

	static string TempFile(string extension) =>
		Path.Combine(Path.GetTempPath(), "vdf-capture-" + Guid.NewGuid().ToString("N") + extension);

	[Fact]
	public void ReadsTheExifDateOfAnImage() {
		string file = TempFile(".tiff");
		try {
			File.WriteAllBytes(file, TiffWithDate("2021:07:04 10:20:30"));
			Assert.True(CaptureTimeReader.TryRead(file, out DateTime captured));
			Assert.Equal(new DateTime(2021, 7, 4, 10, 20, 30, DateTimeKind.Utc), captured);
		}
		finally {
			File.Delete(file);
		}
	}

	[Fact]
	public void FilesWithoutADateAreLeftOut() {
		string plain = TempFile(".tiff");
		string text = TempFile(".txt");
		string missing = TempFile(".jpg");
		try {
			File.WriteAllBytes(plain, new byte[64]);
			File.WriteAllText(text, "not media");
			Assert.False(CaptureTimeReader.TryRead(plain, out _));
			Assert.False(CaptureTimeReader.TryRead(text, out _));
			Assert.False(CaptureTimeReader.TryRead(missing, out _));
		}
		finally {
			File.Delete(plain);
			File.Delete(text);
		}
	}

	[Fact]
	public void ReadManyKeepsOnlyTheFilesThatHaveADate() {
		string dated = TempFile(".tiff");
		string undated = TempFile(".tiff");
		try {
			File.WriteAllBytes(dated, TiffWithDate("2019:01:02 03:04:05"));
			File.WriteAllBytes(undated, new byte[64]);
			Dictionary<string, DateTime> found = CaptureTimeReader.ReadMany(new[] { dated, undated }, parallelism: 4);
			Assert.Single(found);
			Assert.Equal(new DateTime(2019, 1, 2, 3, 4, 5, DateTimeKind.Utc), found[dated]);
		}
		finally {
			File.Delete(dated);
			File.Delete(undated);
		}
	}

	[Fact]
	public void DatesRoundTripThroughTheJsonFile() {
		string file = TempFile(".json");
		try {
			var times = new Dictionary<string, DateTime> {
				["/media/a.jpg"] = new DateTime(2020, 5, 6, 7, 8, 9, DateTimeKind.Utc),
				["/media/b.mp4"] = new DateTime(2021, 1, 1, 0, 0, 0, DateTimeKind.Unspecified),
			};
			CaptureTimeReader.WriteJson(file, times);
			Dictionary<string, DateTime> read = CaptureTimeReader.ReadJson(file);
			Assert.Equal(times["/media/a.jpg"], read["/media/a.jpg"]);
			Assert.Equal(new DateTime(2021, 1, 1, 0, 0, 0, DateTimeKind.Utc), read["/media/b.mp4"]);
			Assert.All(read.Values, value => Assert.Equal(DateTimeKind.Utc, value.Kind));
		}
		finally {
			File.Delete(file);
		}
	}

	[Fact]
	public void ValuesThatAreNotDatesAreSkipped() {
		string file = TempFile(".json");
		try {
			File.WriteAllText(file, "{\"/a.jpg\":\"2020-01-02T03:04:05Z\",\"/b.jpg\":\"yesterday\",\"/c.jpg\":\"\"}");
			Dictionary<string, DateTime> read = CaptureTimeReader.ReadJson(file);
			Assert.Equal(new[] { "/a.jpg" }, read.Keys.ToArray());
		}
		finally {
			File.Delete(file);
		}
	}

	[Fact]
	public void AnEntryUsesItsFileDateUntilACaptureDateIsGiven() {
		var entry = new FileEntry { Path = TempFile(".jpg"), DateCreated = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc) };
		Assert.Equal(entry.DateCreated, entry.CaptureTime);
		entry.captureOverride = new DateTime(2018, 6, 1, 0, 0, 0, DateTimeKind.Utc);
		Assert.Equal(new DateTime(2018, 6, 1, 0, 0, 0, DateTimeKind.Utc), entry.CaptureTime);
		entry.captureOverride = null;
		Assert.Equal(entry.DateCreated, entry.CaptureTime);
	}

	[Fact]
	public void AChangedCaptureDateVoidsTheStoredRows() {
		var settings = new Settings { Percent = 96, TimeWindowDays = 7 };
		var a = new FileEntry { Path = TempFile("-a.jpg"), DateCreated = TimeWindow.Epoch, DateModified = TimeWindow.Epoch, FileSize = 10 };
		var b = new FileEntry { Path = TempFile("-b.jpg"), DateCreated = TimeWindow.Epoch, DateModified = TimeWindow.Epoch, FileSize = 10 };
		var store = new PairScoreStore();
		store.UpsertGray(a, b, 92);
		store.MarkCovered(new[] { a, b }, 7, settings);
		Assert.Equal(PairCompareAction.UseStored, store.Decide(a, b, settings));

		// Edited in Immich to a day months away: the old score no longer applies to this pair.
		b.captureOverride = TimeWindow.Epoch.AddDays(200);
		Assert.Equal(PairCompareAction.Skip, store.Decide(a, b, settings));
		PairSession session = store.BeginCompare(new[] { a, b }, settings);
		Assert.Equal(0, session.Count);

		// Back within the window, but the old row is gone, so the pair is scored again.
		b.captureOverride = TimeWindow.Epoch.AddDays(1);
		Assert.Equal(PairCompareAction.Compute, store.Decide(a, b, settings));
	}
}
