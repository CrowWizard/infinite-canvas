package service

import (
	"errors"
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
	if err := storeNewAPITokens(userID, tokens); err != nil {
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

func storeNewAPITokens(userID string, tokens []NewAPIToken) error {
	stored := make([]model.UserNewAPIToken, 0, len(tokens))
	for _, token := range tokens {
		ciphertext, nonce, err := encryptCredential(token.Key)
		if err != nil {
			return err
		}
		stored = append(stored, model.UserNewAPIToken{
			ID: newID("newapi_token"), UserID: userID, NewAPITokenID: token.ID, Name: token.Name,
			TokenCiphertext: ciphertext, TokenNonce: nonce, IsEnabled: token.Enabled, IsDefault: token.Default,
			ExpiredAt: token.ExpiredAt, LastSyncedAt: now(), CreatedAt: now(), UpdatedAt: now(),
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
