package answer

type MultiFormater struct {
}

func (format MultiFormater) Format(payload *Payload) string {

	res := ""

	if len(payload.Answer.Yes) > 1 {
		res += "✅ " + payload.Answer.Yes + "\n"
	}

	if len(payload.Answer.No) > 1 {
		res += "❌ " + payload.Answer.No + "\n"
	}

	if len(payload.Answer.Step) > 1 {
		res += "📖 " + payload.Answer.Step + "\n"
	}

	if len(payload.Answer.Ext) > 1 {
		res += "➕ " + payload.Answer.Step + "\n"
	}

	return res
}

func NewMultiFormater() *MultiFormater {
	return &MultiFormater{}
}
