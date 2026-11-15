package sample;

/** Prints a summary of a sentence. */
public final class Main {
  private Main() {}

  public static void main(String[] args) {
    String text = "the quick brown fox jumps over the lazy dog";
    System.out.println(Report.summarize(text));
    System.out.println(Words.countWords(text) + " words in all");
  }
}
