package xrequestid

type Option interface {
	apply(*options)
}

type optionApplyer func(*options)

func (a optionApplyer) apply(opt *options) {
	a(opt)
}

type options struct {
	validator validator
}

func RequestIDValidator(validator validator) Option {
	return optionApplyer(func(opt *options) {
		opt.validator = validator
	})
}
