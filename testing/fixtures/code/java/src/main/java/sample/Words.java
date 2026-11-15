package sample;

import java.util.HashMap;
import java.util.Map;

/** Counting words. */
public final class Words {
  private Words() {}

  /** Counts the words in {@code text}: runs of characters between whitespace. */
  public static int countWords(String text) {
    String trimmed = text.trim();
    return trimmed.isEmpty() ? 0 : trimmed.split("\\s+").length;
  }

  /** Counts how often each word comes up. */
  public static final class Tally {
    private final Map<String, Integer> counts = new HashMap<>();

    /** Adds one more sighting of {@code word}, and returns how many have been seen. */
    public int add(String word) {
      return counts.merge(word, 1, Integer::sum);
    }

    /** The word seen most often, or {@code null} before any. */
    public String top() {
      String best = null;
      for (Map.Entry<String, Integer> entry : counts.entrySet()) {
        if (best == null || entry.getValue() > counts.get(best)) {
          best = entry.getKey();
        }
      }
      return best;
    }
  }
}
