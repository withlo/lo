use sample::report::summarize;
use sample::words::count_words;

fn main() {
    let text = "the quick brown fox jumps over the lazy dog";
    println!("{}", summarize(text));
    println!("{} words in all", count_words(text));
}
