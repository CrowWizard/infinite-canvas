package model

import "gorm.io/datatypes"

// UserNewAPICredential stores encrypted credentials and the current NewAPI session.
type UserNewAPICredential struct {
	ID                      string `json:"id" gorm:"primaryKey"`
	UserID                  string `json:"userId" gorm:"uniqueIndex;not null"`
	NewAPIUsername          string `json:"newapiUsername"`
	PasswordCiphertext      string `json:"-" gorm:"type:text"`
	PasswordNonce           string `json:"-"`
	PasswordVersion         int    `json:"-"`
	SessionCookieCiphertext string `json:"-" gorm:"type:text"`
	SessionCookieNonce      string `json:"-"`
	SessionExpiresAt        string `json:"sessionExpiresAt"`
	ReauthRequired          bool   `json:"reauthRequired"`
	LastSyncAt              string `json:"lastSyncAt"`
	LastError               string `json:"lastError"`
	CreatedAt               string `json:"createdAt"`
	UpdatedAt               string `json:"updatedAt"`
}

type UserNewAPIToken struct {
	ID              string         `json:"id" gorm:"primaryKey"`
	UserID          string         `json:"userId" gorm:"uniqueIndex:idx_user_newapi_token;not null"`
	NewAPITokenID   string         `json:"tokenId" gorm:"uniqueIndex:idx_user_newapi_token;not null"`
	Name            string         `json:"name"`
	TokenCiphertext string         `json:"-" gorm:"type:text"`
	TokenNonce      string         `json:"-"`
	IsEnabled       bool           `json:"enabled"`
	IsDefault       bool           `json:"isDefault"`
	ExpiredAt       string         `json:"expiredAt"`
	ModelList       datatypes.JSON `json:"modelList" gorm:"type:jsonb"`
	LastSyncedAt    string         `json:"lastSyncedAt"`
	CreatedAt       string         `json:"createdAt"`
	UpdatedAt       string         `json:"updatedAt"`
}

type AIModelType string

const (
	AIModelTypeText  AIModelType = "text"
	AIModelTypeImage AIModelType = "image"
	AIModelTypeVideo AIModelType = "video"
	AIModelTypeAudio AIModelType = "audio"
)

type AIModel struct {
	ID            string      `json:"id" gorm:"primaryKey"`
	ModelID       string      `json:"modelId" gorm:"uniqueIndex;not null"`
	DisplayName   string      `json:"displayName"`
	ModelType     AIModelType `json:"modelType" gorm:"index;not null"`
	Provider      string      `json:"provider"`
	Enabled       bool        `json:"enabled"`
	SortOrder     int         `json:"sortOrder"`
	Capabilities  string      `json:"capabilities" gorm:"type:jsonb"`
	NewAPITokenID string      `json:"newApiTokenId,omitempty" gorm:"column:new_api_token_id;->"`
	CreatedAt     string      `json:"createdAt"`
	UpdatedAt     string      `json:"updatedAt"`
}

type UserAIModel struct {
	ID            string `json:"id" gorm:"primaryKey"`
	UserID        string `json:"userId" gorm:"uniqueIndex:idx_user_ai_model;not null"`
	AIModelID     string `json:"aiModelId" gorm:"uniqueIndex:idx_user_ai_model;not null"`
	IsEnabled     bool   `json:"enabled"`
	NewAPITokenID string `json:"newApiTokenId" gorm:"index"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

type PublicNewAPIToken struct {
	TokenID      string `json:"tokenId"`
	Name         string `json:"name"`
	Enabled      bool   `json:"enabled"`
	IsDefault    bool   `json:"isDefault"`
	ExpiredAt    string `json:"expiredAt"`
	LastSyncedAt string `json:"lastSyncedAt"`
}
