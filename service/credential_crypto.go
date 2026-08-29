package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"

	"github.com/tigerowo/infinite-canvas/config"
)

func encryptCredential(value string) (string, string, error) {
	key, err := credentialKey()
	if err != nil {
		return "", "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", "", err
	}
	ciphertext := gcm.Seal(nil, nonce, []byte(value), nil)
	return base64.RawStdEncoding.EncodeToString(ciphertext), base64.RawStdEncoding.EncodeToString(nonce), nil
}

func decryptCredential(ciphertext, nonce string) (string, error) {
	key, err := credentialKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceBytes, err := base64.RawStdEncoding.DecodeString(nonce)
	if err != nil || len(nonceBytes) != gcm.NonceSize() {
		return "", errors.New("凭据 nonce 无效")
	}
	cipherBytes, err := base64.RawStdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", errors.New("凭据密文无效")
	}
	plain, err := gcm.Open(nil, nonceBytes, cipherBytes, nil)
	if err != nil {
		return "", errors.New("凭据解密失败")
	}
	return string(plain), nil
}

func credentialKey() ([]byte, error) {
	key, err := base64.RawStdEncoding.DecodeString(config.Cfg.CredentialKey)
	if err != nil || len(key) != 32 {
		return nil, errors.New("USER_CREDENTIAL_ENCRYPTION_KEY 必须是 32 字节 Base64 密钥")
	}
	return key, nil
}
