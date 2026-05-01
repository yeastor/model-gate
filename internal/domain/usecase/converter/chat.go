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
	return &usecase.Question{
		Question: request.ChatBody.Question.Q,
		Variant: usecase.Variant{
			ID: request.ChatBody.Question.Variant.GetId(),
		},
		Category: usecase.Category{
			ID: request.ChatBody.Question.Category.GetId(),
		},
	}
}

func FromUseCaseAnswerToDescChatResponse(request *usecase.Answer) *desc.ChatResponse {
	if request == nil {
		return &desc.ChatResponse{}
	}

	return &desc.ChatResponse{Answer: &desc.ChatAnswer{
		Content:  request.Content,
		Next:     fromUseCaseNextToDescNext(request.Next),
		Category: fromUseCaseCategoryToDescCategory(request.Category),
	}}
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

func fromUseCaseNextToDescNext(next []*usecase.Next) []*desc.Next {
	if len(next) == 0 {
		return nil
	}

	result := make([]*desc.Next, 0, len(next))
	for _, item := range next {
		result = append(result, &desc.Next{
			QuestionText: item.QuestionText,
			View:         fromUseCaseViewToDescView(item.View),
		})
	}

	return result
}

func fromUseCaseViewToDescView(view []*usecase.View) []*desc.View {
	if len(view) == 0 {
		return nil
	}

	result := make([]*desc.View, 0, len(view))
	for _, item := range view {
		result = append(result, &desc.View{
			Type:       item.Type,
			Id:         item.ID,
			Value:      item.Value,
			Question:   item.Question,
			CategoryId: item.CategoryID,
			VariantId:  item.VariantID,
		})
	}

	return result
}

func fromUseCaseCategoryToDescCategory(category usecase.Category) *desc.Category {
	if category.ID == "" {
		return nil
	}

	return &desc.Category{
		Id: category.ID,
	}
}
