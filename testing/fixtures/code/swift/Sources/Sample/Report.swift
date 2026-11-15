/// A summary of `text`: how many words it has, and the one that comes up most.
func summarize(_ text: String) -> String {
    var tally = Tally()
    for word in text.split(whereSeparator: { $0.isWhitespace }) {
        tally.add(word.lowercased())
    }
    let total = countWords(text)
    return "\(total) words, mostly \"\(tally.top() ?? "")\""
}
