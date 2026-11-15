namespace Sample;

/// <summary>Counting words.</summary>
public static class Words
{
    /// <summary>Counts the words in <paramref name="text"/>: runs of characters between whitespace.</summary>
    public static int CountWords(string text) =>
        text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;
}

/// <summary>Counts how often each word comes up.</summary>
public sealed class Tally
{
    private readonly Dictionary<string, int> counts = new();

    /// <summary>Adds one more sighting of <paramref name="word"/>, and returns how many have been seen.</summary>
    public int Add(string word)
    {
        counts.TryGetValue(word, out var seen);
        counts[word] = ++seen;
        return seen;
    }

    /// <summary>The word seen most often, or null before any.</summary>
    public string? Top() =>
        counts.OrderByDescending(entry => entry.Value).Select(entry => entry.Key).FirstOrDefault();
}
