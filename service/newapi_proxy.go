package service

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

// NewAPIModelChannel returns a server-side channel backed by the user's
// encrypted NewAPI token. The token is never returned to the client.
func NewAPIModelChannelForUserID(userID, modelName string) (model.ModelChannel, error) {
	user, ok, err := repository.GetUserByID(userID)
	if err != nil {
		return model.ModelChannel{}, err
	}
	if !ok {
		return model.ModelChannel{}, errors.New("用户不存在")
	}
	return NewAPIModelChannel(model.PublicUser(user), modelName)
}

func NewAPIModelChannel(user model.AuthUser, modelName string) (model.ModelChannel, error) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return model.ModelChannel{}, errors.New("缺少模型名称")
	}
	models, err := repository.ListUserAIModels(user.ID, user.Role, "")
	if err != nil {
		return model.ModelChannel{}, err
	}
	allowed := false
	for _, item := range models {
		if item.ModelID == modelName {
			allowed = true
			break
		}
	}
	if !allowed {
		return model.ModelChannel{}, errors.New("模型不可用")
	}
	modelItem, ok, err := repository.GetAIModelByModelID(modelName)
	if err != nil {
		return model.ModelChannel{}, err
	}
	if !ok {
		return model.ModelChannel{}, errors.New("模型不存在")
	}
	tokenID, bound, err := repository.GetUserAIModelTokenID(user.ID, modelItem.ID)
	if err != nil {
		return model.ModelChannel{}, err
	}
	if !bound || strings.TrimSpace(tokenID) == "" {
		return model.ModelChannel{}, errors.New("该模型尚未配置 NewAPI Token，请先在设置中选择 Token")
	}
	token, ok, err := repository.GetUserNewAPITokenByID(user.ID, tokenID)
	if err != nil {
		return model.ModelChannel{}, err
	}
	if !ok {
		return model.ModelChannel{}, errors.New("没有可用的 NewAPI Token，请先同步 Token")
	}
	key, err := decryptCredential(token.TokenCiphertext, token.TokenNonce)
	if err != nil {
		return model.ModelChannel{}, err
	}
	if strings.TrimSpace(key) == "" {
		return model.ModelChannel{}, errors.New("NewAPI Token 无效")
	}
	if tokenExpired(token.ExpiredAt) {
		return model.ModelChannel{}, errors.New("NewAPI Token 已过期，请先同步 Token")
	}
	baseURL := strings.TrimRight(strings.TrimSpace(config.Cfg.NewAPIBaseURL), "/")
	if baseURL == "" {
		return model.ModelChannel{}, errors.New("NEWAPI_BASE_URL 未配置")
	}
	return model.ModelChannel{
		ID:       "newapi",
		Protocol: "openai",
		Name:     "NewAPI",
		BaseURL:  baseURL,
		APIKey:   key,
		Models:   []string{modelName},
		Weight:   1,
		Timeout:  600,
		Enabled:  true,
	}, nil
}

func tokenExpired(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || value == "0" || value == "-1" || strings.EqualFold(value, "null") {
		return false
	}
	if number, err := strconv.ParseInt(value, 10, 64); err == nil {
		if number > 1_000_000_000_000 {
			number /= 1000
		}
		return time.Unix(number, 0).Before(time.Now())
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.Before(time.Now())
		}
	}
	return false
}
