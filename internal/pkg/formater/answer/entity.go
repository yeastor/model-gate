package answer

type Payload struct {
	Category Category   `json:"category"`
	Stage    Stage      `json:"stage"`
	Answer   Answer     `json:"answer"`
	Next     []NextStep `json:"next"`
}

type Category struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Stage struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Answer struct {
	Now     string   `json:"now"`
	Steps   []string `json:"steps"`
	Dont    []string `json:"dont"`
	Say     []string `json:"say"`
	WhereTo []string `json:"where_to"`
	Laws    []Law    `json:"laws"`
}

type Law struct {
	Short string `json:"short"`
	Ref   string `json:"ref"`
}

type NextStep struct {
	ID       string `json:"id"`
	Question string `json:"question"`
	Type     string `json:"type"`
	Data     Data   `json:"data"`
}

type Data struct {
	VariantId string `json:"go_to_variant"`
}
