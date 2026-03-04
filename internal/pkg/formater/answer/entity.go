package answer

type Payload struct {
	Category Category     `json:"category"`
	Answer   VectorAnswer `json:"answer"`
	Next     Next         `json:"next"`
}

type Category struct {
	Name string `json:"name"`
}

type VectorAnswer struct {
	Yes  string `json:"yes"`
	No   string `json:"no"`
	Step string `json:"step"`
	Ext  string `json:"ext"`
}

type Next struct {
	Question []string `json:"question"`
}
