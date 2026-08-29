package repository

import (
	"errors"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func GetUserNewAPICredential(userID string) (model.UserNewAPICredential, bool, error) {
	db, err := DB()
	if err != nil {
		return model.UserNewAPICredential{}, false, err
	}
	var credential model.UserNewAPICredential
	err = db.Where("user_id = ?", userID).First(&credential).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return credential, false, nil
	}
	return credential, err == nil, err
}

func SaveUserNewAPICredential(credential model.UserNewAPICredential) (model.UserNewAPICredential, error) {
	db, err := DB()
	if err != nil {
		return credential, err
	}
	if credential.ID == "" {
		credential.ID = "newapi_" + newRepositoryID()
	}
	err = db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"new_api_username", "password_ciphertext", "password_nonce", "password_version",
			"session_cookie_ciphertext", "session_cookie_nonce", "session_expires_at",
			"reauth_required", "last_sync_at", "last_error", "updated_at",
		}),
	}).Create(&credential).Error
	return credential, err
}

func ReplaceUserNewAPITokens(userID string, tokens []model.UserNewAPIToken) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", userID).Delete(&model.UserNewAPIToken{}).Error; err != nil {
			return err
		}
		if len(tokens) == 0 {
			return nil
		}
		return tx.Create(&tokens).Error
	})
}

func EnsureUserAIModels(userID string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	var models []model.AIModel
	if err := db.Where("enabled = ?", true).Find(&models).Error; err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		for _, aiModel := range models {
			var permission model.UserAIModel
			err := tx.Where("user_id = ? AND ai_model_id = ?", userID, aiModel.ID).First(&permission).Error
			if err == nil {
				continue
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			now := time.Now().UTC().Format(time.RFC3339Nano)
			if err := tx.Create(&model.UserAIModel{ID: "user_model_" + newRepositoryID(), UserID: userID, AIModelID: aiModel.ID, IsEnabled: true, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func newRepositoryID() string {
	return time.Now().UTC().Format("20060102150405.000000000")
}

func ListUserAIModels(userID string, role model.UserRole, modelType string) ([]model.AIModel, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	query := db.Model(&model.AIModel{}).Where("ai_models.enabled = ?", true)
	if modelType != "" {
		query = query.Where("ai_models.model_type = ?", modelType)
	}
	if role != model.UserRoleAdmin {
		var permissionCount int64
		if err := db.Model(&model.UserAIModel{}).Where("user_id = ?", userID).Count(&permissionCount).Error; err != nil {
			return nil, err
		}
		if permissionCount > 0 {
			query = query.Joins("JOIN user_ai_models ON user_ai_models.ai_model_id = ai_models.id").Where("user_ai_models.user_id = ? AND user_ai_models.is_enabled = ?", userID, true)
		}
	}
	var models []model.AIModel
	err = query.Order("ai_models.sort_order ASC, ai_models.model_id ASC").Find(&models).Error
	return models, err
}

func ListUserNewAPITokens(userID string) ([]model.PublicNewAPIToken, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var tokens []model.PublicNewAPIToken
	err = db.Model(&model.UserNewAPIToken{}).
		Select("new_api_token_id AS token_id, name, is_enabled AS enabled, is_default, expired_at, last_synced_at").
		Where("user_id = ?", userID).
		Order("is_default DESC, created_at DESC").
		Find(&tokens).Error
	return tokens, err
}

func ListAIModels() ([]model.AIModel, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var models []model.AIModel
	err = db.Order("sort_order ASC, model_id ASC").Find(&models).Error
	return models, err
}

func GetAIModel(id string) (model.AIModel, bool, error) {
	db, err := DB()
	if err != nil {
		return model.AIModel{}, false, err
	}
	var aiModel model.AIModel
	err = db.First(&aiModel, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.AIModel{}, false, nil
	}
	return aiModel, err == nil, err
}

func SaveAIModel(aiModel model.AIModel) (model.AIModel, error) {
	db, err := DB()
	if err != nil {
		return aiModel, err
	}
	return aiModel, db.Save(&aiModel).Error
}

func DeleteAIModel(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("ai_model_id = ?", id).Delete(&model.UserAIModel{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.AIModel{}, "id = ?", id).Error
	})
}

func ListUserAIModelPermissions(userID string) ([]model.UserAIModel, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var permissions []model.UserAIModel
	err = db.Where("user_id = ?", userID).Find(&permissions).Error
	return permissions, err
}

func SaveUserAIModelPermission(permission model.UserAIModel) (model.UserAIModel, error) {
	db, err := DB()
	if err != nil {
		return permission, err
	}
	err = db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "ai_model_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"is_enabled", "updated_at"}),
	}).Create(&permission).Error
	return permission, err
}
