package converter

import (
	"model-gate/internal/domain/entity"
	"model-gate/internal/domain/usecase"
	"model-gate/internal/pkg/model/processor"
	desc "model-gate/pkg/modelgate"
)

const DirectionHuman = 1

const DirectionAi = 2

func FromDescChatRequestToUseCaseQuestion(request *desc.ChatRequest) *usecase.Question {
	return &usecase.Question{Question: request.ChatBody.Question.Q}
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

func FromUseCaseMessagesToDescMessageListResponse(messages []*entity.Message) *desc.MessageListResponse {
	response := &desc.MessageListResponse{}
	for _, message := range messages {
		response.Message = append(response.Message, &desc.Message{
			Text:      message.Question,
			Id:        message.ID.String(),
			Direction: DirectionHuman,
		})

		response.Message = append(response.Message, &desc.Message{
			Text:      message.Answer,
			Id:        message.ID.String(),
			Direction: DirectionAi,
		})
	}
	return response
}
