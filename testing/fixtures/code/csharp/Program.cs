using Sample;

var text = "the quick brown fox jumps over the lazy dog";
Console.WriteLine(Report.Summarize(text));
Console.WriteLine($"{Words.CountWords(text)} words in all");
