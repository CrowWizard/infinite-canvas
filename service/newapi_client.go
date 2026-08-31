package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
)

type NewAPIClient struct {
	BaseURL string
	HTTP    *http.Client
}

type NewAPILoginResult struct {
	ID       string
	Username string
	Cookie   string
}

type newAPIEnvelope struct {
	Success bool            `json:"success"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

func NewAPI() (*NewAPIClient, error) {
	base := strings.TrimRight(strings.TrimSpace(config.Cfg.NewAPIBaseURL), "/")
	if base == "" {
		return nil, errors.New("NEWAPI_BASE_URL 未配置")
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1"))) {
		return nil, errors.New("NEWAPI_BASE_URL 必须是 HTTPS 地址，本地开发可使用 localhost 或 127.0.0.1")
	}
	return &NewAPIClient{BaseURL: base, HTTP: &http.Client{Timeout: 30 * time.Second}}, nil
}

func (c *NewAPIClient) request(method, path string, payload any, cookie, token, newAPIUserID string) (json.RawMessage, error) {
	data, _, err := c.requestWithCookie(method, path, payload, cookie, token, newAPIUserID)
	return data, err
}

func (c *NewAPIClient) requestWithCookie(method, path string, payload any, cookie, token, newAPIUserID string) (json.RawMessage, string, error) {
	var body bytes.Buffer
	if payload != nil {
		if err := json.NewEncoder(&body).Encode(payload); err != nil {
			return nil, "", err
		}
	}
	req, err := http.NewRequest(method, c.BaseURL+path, &body)
	if err != nil {
		return nil, "", err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if strings.TrimSpace(newAPIUserID) == "" {
		newAPIUserID = "-1"
	}
	req.Header.Set("new-api-user", newAPIUserID)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024))
	if err != nil {
		return nil, "", fmt.Errorf("读取 NewAPI 响应失败: %w", err)
	}
	var envelope newAPIEnvelope
	if err := json.Unmarshal(responseBody, &envelope); err != nil {
		return nil, "", fmt.Errorf("NewAPI 响应无效 status=%s body=%q: %w", resp.Status, strings.TrimSpace(string(responseBody)), err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !envelope.Success {
		if envelope.Message == "" {
			envelope.Message = strings.TrimSpace(string(responseBody))
		}
		return nil, "", fmt.Errorf("NewAPI HTTP %s: %s", resp.Status, envelope.Message)
	}
	cookies := make([]string, 0, len(resp.Cookies()))
	for _, item := range resp.Cookies() {
		cookies = append(cookies, item.Name+"="+item.Value)
	}
	return envelope.Data, strings.Join(cookies, "; "), nil
}

func (c *NewAPIClient) Login(username, password string) (NewAPILoginResult, error) {
	data, responseCookie, err := c.requestWithCookie(http.MethodPost, "/api/user/login", map[string]string{"username": username, "password": password}, "", "", "-1")
	if err != nil {
		return NewAPILoginResult{}, err
	}
	var result struct {
		ID       json.RawMessage `json:"id"`
		Username string          `json:"username"`
		Token    string          `json:"token"`
		User     struct {
			ID       json.RawMessage `json:"id"`
			Username string          `json:"username"`
		} `json:"user"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return NewAPILoginResult{}, err
	}
	id := rawString(result.ID)
	loginUsername := result.Username
	if id == "" {
		id = rawString(result.User.ID)
	}
	if loginUsername == "" {
		loginUsername = result.User.Username
	}
	if id == "" {
		return NewAPILoginResult{}, errors.New("NewAPI 登录响应缺少用户 ID")
	}
	if loginUsername == "" {
		loginUsername = username
	}
	if responseCookie == "" {
		responseCookie = result.Token
	}
	return NewAPILoginResult{ID: id, Username: loginUsername, Cookie: responseCookie}, nil
}

func rawString(value json.RawMessage) string {
	if len(value) == 0 || string(value) == "null" {
		return ""
	}
	var text string
	if json.Unmarshal(value, &text) == nil {
		return text
	}
	var number json.Number
	if json.Unmarshal(value, &number) == nil {
		return number.String()
	}
	return ""
}

func (c *NewAPIClient) Self(cookie, token, newAPIUserID string) (json.RawMessage, error) {
	return c.request(http.MethodGet, "/api/user/self", nil, cookie, token, newAPIUserID)
}

type NewAPIToken struct {
	ID        string
	Name      string
	Key       string
	Enabled   bool
	Default   bool
	ExpiredAt string
}

func (c *NewAPIClient) Tokens(cookie, token, newAPIUserID string) ([]NewAPIToken, error) {
	data, err := c.request(http.MethodGet, "/api/token/", nil, cookie, token, newAPIUserID)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Items []struct {
			ID        json.RawMessage `json:"id"`
			Name      string          `json:"name"`
			Key       string          `json:"key"`
			Status    int             `json:"status"`
			Default   bool            `json:"is_default"`
			ExpiredAt json.RawMessage `json:"expired_time"`
		} `json:"items"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, fmt.Errorf("NewAPI Token 响应无效: %w", err)
	}
	tokens := make([]NewAPIToken, 0, len(payload.Items))
	for _, item := range payload.Items {
		var id any
		_ = json.Unmarshal(item.ID, &id)
		if fmt.Sprint(id) == "" {
			continue
		}
		var expired any
		_ = json.Unmarshal(item.ExpiredAt, &expired)
		tokens = append(tokens, NewAPIToken{ID: fmt.Sprint(id), Name: item.Name, Key: item.Key, Enabled: item.Status == 1, Default: item.Default, ExpiredAt: fmt.Sprint(expired)})
	}
	return tokens, nil
}

// TokenKey retrieves the unmasked API key for a token owned by the current user.
func (c *NewAPIClient) TokenKey(cookie, tokenID, newAPIUserID string) (string, error) {
	data, err := c.request(http.MethodPost, "/api/token/"+url.PathEscape(tokenID)+"/key", nil, cookie, "", newAPIUserID)
	if err != nil {
		return "", err
	}
	var payload struct {
		Key string `json:"key"`
	}
	if json.Unmarshal(data, &payload) == nil && strings.TrimSpace(payload.Key) != "" {
		return normalizeNewAPIKey(payload.Key), nil
	}
	var key string
	if json.Unmarshal(data, &key) == nil && strings.TrimSpace(key) != "" {
		return normalizeNewAPIKey(key), nil
	}
	return "", errors.New("NewAPI 返回的 Token Key 无效")
}

func normalizeNewAPIKey(key string) string {
	key = strings.TrimSpace(key)
	if !strings.HasPrefix(key, "sk-") {
		key = "sk-" + key
	}
	return key
}

// Models returns the models available to a NewAPI token through its
// OpenAI-compatible models endpoint.
func (c *NewAPIClient) Models(token string) ([]string, error) {
	endpoint := c.BaseURL + "/v1/models"
	prefix := "<short>"
	if len(token) >= 4 {
		prefix = token[:4]
	}
	log.Printf("NewAPI models request: endpoint=%s tokenPrefix=%q tokenLength=%d", endpoint, prefix, len(token))
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("读取 NewAPI 模型失败: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("读取 NewAPI 模型响应失败: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("NewAPI 模型接口 HTTP %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("NewAPI 模型响应无效: %w", err)
	}
	models := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		if strings.TrimSpace(item.ID) != "" {
			models = append(models, item.ID)
		}
	}
	return models, nil
}
