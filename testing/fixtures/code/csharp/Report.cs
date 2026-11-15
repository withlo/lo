namespace Sample;

/// <summary>Summaries of a text.</summary>
public static class Report
{
    /// <summary>A summary of <paramref name="text"/>: how many words it has, and the one that comes up most.</summary>
    public static string Summarize(string text)
    {
        var tally = new Tally();
        foreach (var word in text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
        {
            tally.Add(word.ToLowerInvariant());
        }
        var total = Words.CountWords(text);
        return $"{total} words, mostly \"{tally.Top()}\"";
    }
}
