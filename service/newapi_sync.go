package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type NewAPISyncStatus struct {
	NewAPIUsername string `json:"newapiUsername"`
	TokenCount     int    `json:"tokenCount"`
	LastSyncAt     string `json:"lastSyncAt"`
	ReauthRequired bool   `json:"reauthRequired"`
	LastError      string `json:"lastError"`
}

// SyncCurrentUserNewAPI refreshes the stored NewAPI session and token metadata.
func SyncCurrentUserNewAPI(userID string) (NewAPISyncStatus, error) {
	credential, ok, err := repository.GetUserNewAPICredential(userID)
	if err != nil {
		return NewAPISyncStatus{}, err
	}
	if !ok {
		return NewAPISyncStatus{}, errors.New("尚未绑定 NewAPI 账号，请先登录")
	}
	user, ok, err := repository.GetUserByID(userID)
	if err != nil {
		return NewAPISyncStatus{}, err
	}
	if !ok || user.NewAPIUserID == "" {
		return NewAPISyncStatus{}, errors.New("NewAPI 用户信息不存在")
	}
	client, err := NewAPI()
	if err != nil {
		return NewAPISyncStatus{}, err
	}
	session, err := decryptCredential(credential.SessionCookieCiphertext, credential.SessionCookieNonce)
	var login *NewAPILoginResult
	var tokens []NewAPIToken
	if err == nil {
		tokens, err = client.Tokens(session, "", user.NewAPIUserID)
	}
	if err != nil {
		password, decryptErr := decryptCredential(credential.PasswordCiphertext, credential.PasswordNonce)
		if decryptErr != nil {
			_ = saveSyncError(credential, decryptErr.Error(), true)
			return NewAPISyncStatus{}, decryptErr
		}
		result, loginErr := client.Login(credential.NewAPIUsername, password)
		if loginErr != nil {
			_ = saveSyncError(credential, loginErr.Error(), true)
			return NewAPISyncStatus{}, loginErr
		}
		login = &result
		tokens, err = client.Tokens(login.Cookie, "", login.ID)
		if err != nil {
			_ = saveSyncError(credential, err.Error(), false)
			return NewAPISyncStatus{}, err
		}
		session = login.Cookie
	}
	if err := storeNewAPITokens(client, userID, session, user.NewAPIUserID, tokens); err != nil {
		_ = saveSyncError(credential, err.Error(), false)
		return NewAPISyncStatus{}, err
	}
	if login != nil {
		cookieCiphertext, cookieNonce, encryptErr := encryptCredential(login.Cookie)
		if encryptErr != nil {
			return NewAPISyncStatus{}, encryptErr
		}
		credential.SessionCookieCiphertext = cookieCiphertext
		credential.SessionCookieNonce = cookieNonce
	}
	credential.ReauthRequired = false
	credential.LastError = ""
	credential.LastSyncAt = time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := repository.SaveUserNewAPICredential(credential); err != nil {
		return NewAPISyncStatus{}, err
	}
	if err := repository.EnsureUserAIModels(userID); err != nil {
		return NewAPISyncStatus{}, err
	}
	return NewAPISyncStatus{NewAPIUsername: credential.NewAPIUsername, TokenCount: len(tokens), LastSyncAt: credential.LastSyncAt}, nil
}

func storeNewAPITokens(client *NewAPIClient, userID, session, newAPIUserID string, tokens []NewAPIToken) error {
	stored := make([]model.UserNewAPIToken, 0, len(tokens))
	for _, token := range tokens {
		key, err := client.TokenKey(session, token.ID, newAPIUserID)
		if err != nil {
			return err
		}
		models, err := client.Models(key)
		if err != nil {
			return err
		}
		modelList, err := json.Marshal(models)
		if err != nil {
			return err
		}
		ciphertext, nonce, err := encryptCredential(key)
		if err != nil {
			return err
		}
		stored = append(stored, model.UserNewAPIToken{
			ID: newID("newapi_token"), UserID: userID, NewAPITokenID: token.ID, Name: token.Name,
			TokenCiphertext: ciphertext, TokenNonce: nonce, IsEnabled: token.Enabled, IsDefault: token.Default,
			ExpiredAt: token.ExpiredAt, ModelList: modelList, LastSyncedAt: now(), CreatedAt: now(), UpdatedAt: now(),
		})
	}
	return repository.ReplaceUserNewAPITokens(userID, stored)
}

func saveSyncError(credential model.UserNewAPICredential, message string, reauth bool) error {
	credential.LastError = message
	credential.ReauthRequired = reauth
	_, err := repository.SaveUserNewAPICredential(credential)
	return err
}

// ListCurrentUserNewAPITokens returns token metadata without exposing secrets.
func ListCurrentUserNewAPITokens(ctx context.Context) ([]model.PublicNewAPIToken, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return nil, errors.New("请先登录")
	}
	return repository.ListUserNewAPITokenMetadata(user.ID)
}

// BindCurrentUserAIModelToken binds one of the user's NewAPI tokens to a model.
func BindCurrentUserAIModelToken(ctx context.Context, aiModelID, tokenID string) error {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return errors.New("请先登录")
	}
	aiModelID = strings.TrimSpace(aiModelID)
	tokenID = strings.TrimSpace(tokenID)
	if aiModelID == "" || tokenID == "" {
		return errors.New("模型和 Token 不能为空")
	}
	aiModel, found, err := repository.GetAIModel(aiModelID)
	if err != nil {
		return err
	}
	if !found {
		return errors.New("模型不存在")
	}
	token, found, err := repository.GetUserNewAPITokenByID(user.ID, tokenID)
	if err != nil {
		return err
	}
	if !found {
		return errors.New("Token 不属于当前用户或已禁用")
	}
	var models []string
	if err := json.Unmarshal(token.ModelList, &models); err != nil {
		return errors.New("Token 模型列表无效，请先同步 Token")
	}
	matched := false
	for _, name := range models {
		if strings.TrimSpace(name) == aiModel.ModelID {
			matched = true
			break
		}
	}
	if !matched {
		return errors.New("该 Token 不支持此模型")
	}
	return repository.SaveUserAIModelToken(user.ID, aiModel.ID, token.NewAPITokenID)
}
