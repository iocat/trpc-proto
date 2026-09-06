package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	pb "example/backend/gen/examplev1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const addr = "127.0.0.1:50051"

// Bearer token required on every RPC. Same value in the dashboard and tRPC client.
const authToken = "ae_9f2e4c8b7a1d6e0f3c5b8a2d7e4f1c90"

func authInterceptor(
	ctx context.Context,
	req any,
	_ *grpc.UnaryServerInfo,
	handler grpc.UnaryHandler,
) (any, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "missing metadata")
	}
	got := strings.TrimSpace(strings.Join(md.Get("authorization"), " "))
	if got != "Bearer "+authToken {
		return nil, status.Error(codes.Unauthenticated, "invalid token")
	}
	return handler(ctx, req)
}

type store struct {
	mu    sync.Mutex
	users map[string]*pb.User
}

func newStore() *store {
	s := &store{users: map[string]*pb.User{}}
	s.users["user_ada"] = &pb.User{
		Id:    proto.String("user_ada"),
		Name:  proto.String("Ada"),
		Email: proto.String("ada@example.com"),
		Role:  pb.UserRole_USER_ROLE_ADMIN.Enum(),
		Tags:  []string{"founder", "math"},
		Address: &pb.Address{
			City:    proto.String("London"),
			Country: proto.String("UK"),
		},
		CreatedAt: timestamppb.New(time.Date(1815, 12, 10, 0, 0, 0, 0, time.UTC)),
		Active:    proto.Bool(true),
		Karma:     proto.Int32(42),
		Score:     proto.Float64(99.5),
		Balance:   proto.Int64(1000),
	}
	return s
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return time.Now().UTC().Format("user_20060102150405.000000000")
	}
	return "user_" + hex.EncodeToString(b[:])
}

type appServer struct {
	pb.UnimplementedAppServer
}

func (appServer) Health(context.Context, *emptypb.Empty) (*pb.AppHealthResponse, error) {
	return &pb.AppHealthResponse{
		Ok:      proto.Bool(true),
		Version: proto.String("0.0.0"),
	}, nil
}

func (appServer) Hello(_ context.Context, req *pb.AppHelloRequest) (*pb.AppHelloResponse, error) {
	return &pb.AppHelloResponse{
		Message: proto.String("hello " + req.GetName()),
	}, nil
}

func (appServer) Echo(_ context.Context, req *pb.AppEchoRequest) (*pb.AppEchoResponse, error) {
	return &pb.AppEchoResponse{Value: proto.String(req.GetValue())}, nil
}

type userServer struct {
	pb.UnimplementedUserServiceServer
	store *store
}

func (s *userServer) GetById(_ context.Context, req *pb.UserGetByIdRequest) (*pb.User, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	user, ok := s.store.users[req.GetId()]
	if !ok {
		return nil, status.Error(codes.NotFound, req.GetId())
	}
	return cloneUser(user), nil
}

func (s *userServer) List(_ context.Context, req *pb.UserListRequest) (*pb.UserListResponse, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	q := strings.ToLower(req.GetQ())
	items := make([]*pb.User, 0, len(s.store.users))
	for _, user := range s.store.users {
		if q != "" {
			name := strings.ToLower(user.GetName())
			email := strings.ToLower(user.GetEmail())
			if !strings.Contains(name, q) && !strings.Contains(email, q) {
				continue
			}
		}
		if req.Role != nil && user.GetRole() != req.GetRole() {
			continue
		}
		items = append(items, cloneUser(user))
	}
	return &pb.UserListResponse{
		Items: items,
		Total: proto.Int32(int32(len(items))),
	}, nil
}

func (s *userServer) Create(_ context.Context, req *pb.UserCreateRequest) (*pb.User, error) {
	role := pb.UserRole_USER_ROLE_MEMBER
	if req.Role != nil {
		role = req.GetRole()
	}
	user := &pb.User{
		Id:        proto.String(newID()),
		Name:      proto.String(req.GetName()),
		Email:     proto.String(req.GetEmail()),
		Role:      role.Enum(),
		Tags:      append([]string{}, req.GetTags()...),
		Address:   req.GetAddress(),
		CreatedAt: timestamppb.Now(),
		Active:    proto.Bool(true),
		Karma:     proto.Int32(0),
		Score:     proto.Float64(0),
		Balance:   proto.Int64(0),
	}
	s.store.mu.Lock()
	s.store.users[user.GetId()] = user
	s.store.mu.Unlock()
	return cloneUser(user), nil
}

type orgServer struct {
	pb.UnimplementedOrgWorkspaceServer
	store *store
}

func (s *orgServer) Stats(context.Context, *emptypb.Empty) (*pb.WorkspaceStats, error) {
	s.store.mu.Lock()
	n := len(s.store.users)
	s.store.mu.Unlock()
	return &pb.WorkspaceStats{
		Name:  proto.String("analytical-engine"),
		Users: proto.Int32(int32(n)),
		Labels: map[string]int32{
			"core": 3,
			"labs": 1,
		},
	}, nil
}

func cloneUser(user *pb.User) *pb.User {
	return proto.Clone(user).(*pb.User)
}

func main() {
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatal(err)
	}
	store := newStore()
	server := grpc.NewServer(grpc.UnaryInterceptor(authInterceptor))
	pb.RegisterAppServer(server, appServer{})
	pb.RegisterUserServiceServer(server, &userServer{store: store})
	pb.RegisterOrgWorkspaceServer(server, &orgServer{store: store})
	log.SetOutput(os.Stdout)
	log.Printf("gRPC listening on %s\n", addr)
	if err := server.Serve(lis); err != nil {
		log.Fatal(err)
	}
}
