package answer

import "strings"

type MultiFormater struct {
}

func (format MultiFormater) Format(payload *Payload) string {
	sections := make([]string, 0, 6)

	if payload.Answer.Now != "" {
		sections = append(sections, payload.Answer.Now)
	}

	if steps := formatList("✅Что делать", payload.Answer.Steps); steps != "" {
		sections = append(sections, steps)
	}

	if dont := formatList("❌Чего не делать", payload.Answer.Dont); dont != "" {
		sections = append(sections, dont)
	}

	if say := formatList("📢Что сказать", payload.Answer.Say); say != "" {
		sections = append(sections, say)
	}

	if whereTo := formatList("🖊️Куда обратиться", payload.Answer.WhereTo); whereTo != "" {
		sections = append(sections, whereTo)
	}

	if laws := formatLaws(payload.Answer.Laws); laws != "" {
		sections = append(sections, laws)
	}

	if payload.Next != nil && payload.Next[0].Question != "" {
		sections = append(sections, "Следующий вопрос: "+payload.Next[0].Question)
	}

	return strings.Join(sections, "\n\n")
}

func NewMultiFormater() *MultiFormater {
	return &MultiFormater{}
}

func formatList(title string, items []string) string {
	filtered := make([]string, 0, len(items))
	for _, item := range items {
		if item != "" {
			filtered = append(filtered, item)
		}
	}

	if len(filtered) == 0 {
		return ""
	}

	var builder strings.Builder
	builder.WriteString(title)
	builder.WriteString(":\n")

	for _, item := range filtered {
		builder.WriteString("- ")
		builder.WriteString(item)
		builder.WriteString("\n")
	}

	return strings.TrimSuffix(builder.String(), "\n")
}

func formatLaws(laws []Law) string {
	items := make([]string, 0, len(laws))
	for _, law := range laws {
		item := law.Short
		switch {
		case item != "" && law.Ref != "":
			item += " (" + law.Ref + ")"
		case item == "":
			item = law.Ref
		}

		if item != "" {
			items = append(items, item)
		}
	}

	return formatList("🧑‍⚖️ Законы: ", items)
}
