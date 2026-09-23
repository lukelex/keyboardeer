// manager-api-harness exercises currently implemented manager API methods.
// It is an explicit development/integration tool, never a GUI fallback.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/lukelex/keyboardeer/internal/managerapi"
)

func main() {
	var endpoint, deviceID, behavior, action string
	flag.StringVar(&endpoint, "socket", managerapi.DefaultEndpoint(), "manager Unix socket path")
	flag.StringVar(&deviceID, "device", "", "opaque device ID for preview or identify")
	flag.StringVar(&behavior, "behavior", "", "platform-neutral behavior for preview")
	flag.StringVar(&action, "action", "list", "list, manager, snapshot, preview, identify, cancel, or operation")
	flag.Parse()
	client := managerapi.New(managerapi.Options{Endpoint: endpoint, ClientName: "keyboardeer-integration-harness", ClientVersion: "0.1.0-dev"})
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var result any
	var err error
	switch action {
	case "list":
		result, err = client.DeviceList(ctx)
	case "manager":
		result, err = client.ManagerGet(ctx)
	case "snapshot":
		result, err = client.SnapshotGet(ctx)
	case "preview":
		if deviceID == "" || behavior == "" {
			fail("-device and -behavior are required for preview")
		}
		result, err = client.Preview(ctx, managerapi.PreviewParams{Model: &managerapi.PreviewModel{DeviceID: deviceID, Behavior: behavior}})
	case "identify":
		if deviceID == "" {
			fail("-device is required for identify")
		}
		result, err = client.IdentifyStart(ctx, managerapi.IdentifyStartParams{DeviceID: deviceID, TimeoutMS: 15_000})
	case "cancel":
		if deviceID == "" {
			fail("-device is the operation ID for cancel")
		}
		result, err = client.IdentifyCancel(ctx, deviceID)
	case "operation":
		if deviceID == "" {
			fail("-device is the operation ID for operation")
		}
		result, err = client.OperationGet(ctx, deviceID)
	default:
		fail("-action must be list, manager, snapshot, preview, identify, cancel, or operation")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "manager API:", err)
		os.Exit(1)
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fail(err.Error())
	}
}
func fail(message string) { fmt.Fprintln(os.Stderr, message); os.Exit(2) }
