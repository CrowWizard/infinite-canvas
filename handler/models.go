package handler

import (
	"net/http"

	"github.com/tigerowo/infinite-canvas/service"
)

func ListModels(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		FailWithStatus(w, http.StatusUnauthorized, "未登录")
		return
	}
	data, err := service.ListModels(user, r.URL.Query().Get("type"))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, data)
}
