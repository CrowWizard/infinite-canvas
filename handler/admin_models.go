package handler

import (
	"encoding/json"
	"net/http"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func AdminUserModels(w http.ResponseWriter, r *http.Request, userID string) {
	data, err := service.AdminUserModelDataFor(userID)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, data)
}

func AdminModels(w http.ResponseWriter, r *http.Request) {
	models, err := service.AdminAIModels()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, models)
}

func AdminSaveModel(w http.ResponseWriter, r *http.Request) {
	var input model.AIModel
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		FailWithStatus(w, http.StatusBadRequest, "请求参数无效")
		return
	}
	result, err := service.SaveAdminAIModel(input)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func AdminDeleteModel(w http.ResponseWriter, r *http.Request, modelID string) {
	if err := service.DeleteAdminAIModel(modelID); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

func AdminSaveUserModel(w http.ResponseWriter, r *http.Request, userID string) {
	var input struct {
		AIModelID string `json:"aiModelId"`
		Enabled   bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		FailWithStatus(w, http.StatusBadRequest, "请求参数无效")
		return
	}
	permission, err := service.SaveAdminUserAIModelPermission(userID, input.AIModelID, input.Enabled)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, permission)
}
