package service

import (
	"errors"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type ModelDirectory struct {
	Text  []model.AIModel `json:"text"`
	Image []model.AIModel `json:"image"`
	Video []model.AIModel `json:"video"`
	Audio []model.AIModel `json:"audio"`
}

func ListModels(user model.AuthUser, modelType string) (any, error) {
	modelType = strings.TrimSpace(modelType)
	if modelType != "" && modelType != string(model.AIModelTypeText) && modelType != string(model.AIModelTypeImage) && modelType != string(model.AIModelTypeVideo) && modelType != string(model.AIModelTypeAudio) {
		return nil, errors.New("模型类型无效")
	}
	if modelType != "" {
		return repository.ListUserAIModels(user.ID, user.Role, modelType)
	}
	result := ModelDirectory{}
	var err error
	if result.Text, err = repository.ListUserAIModels(user.ID, user.Role, string(model.AIModelTypeText)); err != nil {
		return nil, err
	}
	if result.Image, err = repository.ListUserAIModels(user.ID, user.Role, string(model.AIModelTypeImage)); err != nil {
		return nil, err
	}
	if result.Video, err = repository.ListUserAIModels(user.ID, user.Role, string(model.AIModelTypeVideo)); err != nil {
		return nil, err
	}
	if result.Audio, err = repository.ListUserAIModels(user.ID, user.Role, string(model.AIModelTypeAudio)); err != nil {
		return nil, err
	}
	return result, nil
}
