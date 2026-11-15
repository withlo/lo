package sample;

/** Summaries of a text. */
public final class Report {
  private Report() {}

  /** A summary of {@code text}: how many words it has, and the one that comes up most. */
  public static String summarize(String text) {
    Words.Tally tally = new Words.Tally();
    for (String word : text.split("\\s+")) {
      if (!word.isEmpty()) {
        tally.add(word.toLowerCase());
      }
    }
    int total = Words.countWords(text);
    return total + " words, mostly \"" + tally.top() + "\"";
  }
}
