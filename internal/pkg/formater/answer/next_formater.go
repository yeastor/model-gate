package answer

func FormatNextQuestion(question string, viewType string) string {
	if viewType == NextTypeBadge {
		return question + " Да."
	}

	return question
}
