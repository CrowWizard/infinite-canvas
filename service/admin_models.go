package service

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type AdminUserModelInfo struct {
	model.AIModel
	UserEnabled *bool `json:"userEnabled"`
}

type AdminUserModelData struct {
	Tokens []model.PublicNewAPIToken `json:"tokens"`
	Models []AdminUserModelInfo      `json:"models"`
}

func AdminUserModelDataFor(userID string) (AdminUserModelData, error) {
	if _, ok, err := repository.GetUserByID(userID); err != nil {
		return AdminUserModelData{}, err
	} else if !ok {
		return AdminUserModelData{}, errors.New("用户不存在")
	}
	tokens, err := repository.ListUserNewAPITokens(userID)
	if err != nil {
		return AdminUserModelData{}, err
	}
	models, err := repository.ListAIModels()
	if err != nil {
		return AdminUserModelData{}, err
	}
	permissions, err := repository.ListUserAIModelPermissions(userID)
	if err != nil {
		return AdminUserModelData{}, err
	}
	permissionMap := make(map[string]bool, len(permissions))
	for _, permission := range permissions {
		permissionMap[permission.AIModelID] = permission.IsEnabled
	}
	result := AdminUserModelData{Tokens: tokens, Models: make([]AdminUserModelInfo, 0, len(models))}
	for _, aiModel := range models {
		item := AdminUserModelInfo{AIModel: aiModel}
		if enabled, ok := permissionMap[aiModel.ID]; ok {
			item.UserEnabled = &enabled
		}
		result.Models = append(result.Models, item)
	}
	return result, nil
}

func AdminAIModels() ([]model.AIModel, error) {
	return repository.ListAIModels()
}

func SaveAdminAIModel(input model.AIModel) (model.AIModel, error) {
	input.ModelID = strings.TrimSpace(input.ModelID)
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	input.Provider = strings.TrimSpace(input.Provider)
	if input.ModelID == "" {
		return input, errors.New("模型 ID 不能为空")
	}
	switch input.ModelType {
	case model.AIModelTypeText, model.AIModelTypeImage, model.AIModelTypeVideo, model.AIModelTypeAudio:
	default:
		return input, errors.New("模型类型无效")
	}
	if input.Capabilities == "" {
		input.Capabilities = "{}"
	}
	var capabilities any
	if err := json.Unmarshal([]byte(input.Capabilities), &capabilities); err != nil {
		return input, errors.New("Capabilities 必须是有效 JSON")
	}
	if input.ID == "" {
		input.ID = newID("ai_model")
		now := time.Now().UTC().Format(time.RFC3339Nano)
		input.CreatedAt = now
	}
	input.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	return repository.SaveAIModel(input)
}

func DeleteAdminAIModel(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("模型 ID 不能为空")
	}
	if _, ok, err := repository.GetAIModel(id); err != nil {
		return err
	} else if !ok {
		return errors.New("模型不存在")
	}
	return repository.DeleteAIModel(id)
}

func SaveAdminUserAIModelPermission(userID string, aiModelID string, enabled bool) (model.UserAIModel, error) {
	if _, ok, err := repository.GetUserByID(userID); err != nil {
		return model.UserAIModel{}, err
	} else if !ok {
		return model.UserAIModel{}, errors.New("用户不存在")
	}
	if _, ok, err := repository.GetAIModel(aiModelID); err != nil {
		return model.UserAIModel{}, err
	} else if !ok {
		return model.UserAIModel{}, errors.New("模型不存在")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	return repository.SaveUserAIModelPermission(model.UserAIModel{ID: newID("user_model"), UserID: userID, AIModelID: aiModelID, IsEnabled: enabled, CreatedAt: now, UpdatedAt: now})
}
