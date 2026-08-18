package core
import "os"
func CurrentDirectory() (string, error) { return os.Getwd() }
