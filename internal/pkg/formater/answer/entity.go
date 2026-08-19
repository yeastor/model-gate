package answer

import (
	"encoding/json"
	"fmt"
)

const NextTypeBadge = "badge"
const NextTypeChoice = "choice"

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
	Now     string        `json:"now"`
	Steps   []string      `json:"steps"`
	Dont    []string      `json:"dont"`
	Say     []string      `json:"say"`
	WhereTo []Destination `json:"where_to"`
	Laws    []Law         `json:"laws"`
}

type Destination struct {
	Title          string `json:"title"`
	DocumentLinkID string `json:"document_link_id"`
}

// UnmarshalJSON keeps existing string destinations readable while accepting the
// structured document-link contract used by newly authored variants.
func (destination *Destination) UnmarshalJSON(data []byte) error {
	var legacyTitle string
	if err := json.Unmarshal(data, &legacyTitle); err == nil {
		destination.Title = legacyTitle
		destination.DocumentLinkID = ""
		return nil
	}

	type destinationJSON Destination
	var structured destinationJSON
	if err := json.Unmarshal(data, &structured); err != nil {
		return fmt.Errorf("unmarshal answer destination: %w", err)
	}

	*destination = Destination(structured)
	return nil
}

type Law struct {
	Short string `json:"short"`
	Ref   string `json:"ref"`
	Title string `json:"title"`
	URL   string `json:"url"`
}

type NextStep struct {
	ID       string `json:"id"`
	Question string `json:"question"`
	Type     string `json:"type"`
	Data     []Data `json:"data"`
}

type Data struct {
	Value     string `json:"value"`
	VariantId string `json:"go_to_variant"`
}
