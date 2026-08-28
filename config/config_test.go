package config

import "testing"

func TestLoadUsesPostgresDefaults(t *testing.T) {
	t.Setenv("STORAGE_DRIVER", "")
	t.Setenv("DATABASE_DSN", "")
	t.Setenv("JWT_SECRET", "test-secret")

	if err := Load(); err != nil {
		t.Fatal(err)
	}
	if Cfg.StorageDriver != "postgres" {
		t.Fatalf("StorageDriver = %q, want postgres", Cfg.StorageDriver)
	}
	if Cfg.DatabaseDSN == "" {
		t.Fatal("DatabaseDSN is empty")
	}
}
