package healthhandler

type HealthHandler struct {
}

func NewHealthHandler() *HealthHandler {
	return &HealthHandler{}
}

func (health *HealthHandler) IsAlive() error {
	return nil
}
