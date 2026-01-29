package converter

import (
	"model-gate/internal/domain/usecase"
	"model-gate/internal/pkg/model/processor"
	desc "model-gate/pkg/modelgate"
)

func FromDescChatRequestToUseCaseQuestion(request *desc.ChatRequest) *usecase.Question {
	return &usecase.Question{Question: request.Question.Q}
}

func FromUseCaseAnswerToDescChatResponse(request *usecase.Answer) *desc.ChatResponse {
	return &desc.ChatResponse{Answer: &desc.ChatAnswer{Content: request.Content}}
}

// FromUseCaseQuestionToProcessorQuestion format From[package name][dto name]To[package name name][dto name]
func FromUseCaseQuestionToProcessorQuestion(request *usecase.Question) *processor.Question {
	return &processor.Question{Question: request.Question}
}

func FromProcessorAnswerAnswerToUseCase(request *processor.Answer) *usecase.Answer {
	return &usecase.Answer{Content: request.Content}
}
