package utils

func GenerateChatName(question string) string {
	return truncateString(question, 50)
}

func truncateString(s string, max int) string {
	runes := []rune(s)
	if len(runes) > max {
		return string(runes[:max])
	}
	return s
}
