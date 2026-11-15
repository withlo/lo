use crate::words::{count_words, Tally};

/// A summary of `text`: how many words it has, and the one that comes up most.
pub fn summarize(text: &str) -> String {
    let mut tally = Tally::default();
    for word in text.split_whitespace() {
        tally.add(&word.to_lowercase());
    }
    let total = count_words(text);
    format!("{} words, mostly \"{}\"", total, tally.top().unwrap_or(""))
}
