package sample

/** A summary of [text]: how many words it has, and the one that comes up most. */
fun summarize(text: String): String {
    val tally = Tally()
    for (word in text.split(Regex("\\s+"))) {
        if (word.isNotEmpty()) tally.add(word.lowercase())
    }
    val total = countWords(text)
    return "$total words, mostly \"${tally.top() ?: ""}\""
}
