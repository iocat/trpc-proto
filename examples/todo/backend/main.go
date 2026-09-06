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

	pb "todo/backend/gen/todov1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const addr = "127.0.0.1:50052"

// Bearer token required on every RPC. Same value in the tRPC client.
const authToken = "td_c4a8e1b6f0d39725a8e4b1c7d6f2a905"

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
	todos map[string]*pb.Todo
}

func newStore() *store {
	s := &store{todos: map[string]*pb.Todo{}}
	s.todos["todo_seed"] = &pb.Todo{
		Id:        proto.String("todo_seed"),
		Title:     proto.String("Read the proto"),
		Notes:     proto.String("contract first"),
		Done:      proto.Bool(false),
		CreatedAt: timestamppb.New(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)),
	}
	return s
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return time.Now().UTC().Format("todo_20060102150405.000000000")
	}
	return "todo_" + hex.EncodeToString(b[:])
}

func cloneTodo(todo *pb.Todo) *pb.Todo {
	return proto.Clone(todo).(*pb.Todo)
}

type appServer struct {
	pb.UnimplementedAppServiceServer
}

func (appServer) Health(context.Context, *emptypb.Empty) (*pb.AppHealthResponse, error) {
	return &pb.AppHealthResponse{
		Ok:      proto.Bool(true),
		Version: proto.String("0.0.0"),
	}, nil
}

type todoServer struct {
	pb.UnimplementedTodoServiceServer
	store *store
}

func (s *todoServer) List(_ context.Context, req *pb.TodoListRequest) (*pb.TodoListResponse, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	items := make([]*pb.Todo, 0, len(s.store.todos))
	for _, todo := range s.store.todos {
		if req.Done != nil && todo.GetDone() != req.GetDone() {
			continue
		}
		items = append(items, cloneTodo(todo))
	}
	return &pb.TodoListResponse{
		Items: items,
		Total: proto.Int32(int32(len(items))),
	}, nil
}

func (s *todoServer) GetById(_ context.Context, req *pb.TodoGetByIdRequest) (*pb.Todo, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	todo, ok := s.store.todos[req.GetId()]
	if !ok {
		return nil, status.Error(codes.NotFound, req.GetId())
	}
	return cloneTodo(todo), nil
}

func (s *todoServer) Create(_ context.Context, req *pb.TodoCreateRequest) (*pb.Todo, error) {
	todo := &pb.Todo{
		Id:        proto.String(newID()),
		Title:     proto.String(req.GetTitle()),
		Notes:     proto.String(req.GetNotes()),
		Done:      proto.Bool(false),
		CreatedAt: timestamppb.Now(),
	}
	s.store.mu.Lock()
	s.store.todos[todo.GetId()] = todo
	s.store.mu.Unlock()
	return cloneTodo(todo), nil
}

func (s *todoServer) SetDone(_ context.Context, req *pb.TodoSetDoneRequest) (*pb.Todo, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	todo, ok := s.store.todos[req.GetId()]
	if !ok {
		return nil, status.Error(codes.NotFound, req.GetId())
	}
	todo.Done = proto.Bool(req.GetDone())
	return cloneTodo(todo), nil
}

func (s *todoServer) Remove(_ context.Context, req *pb.TodoGetByIdRequest) (*pb.TodoGetByIdRequest, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	if _, ok := s.store.todos[req.GetId()]; !ok {
		return nil, status.Error(codes.NotFound, req.GetId())
	}
	delete(s.store.todos, req.GetId())
	return &pb.TodoGetByIdRequest{Id: proto.String(req.GetId())}, nil
}

func main() {
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatal(err)
	}
	store := newStore()
	server := grpc.NewServer(grpc.UnaryInterceptor(authInterceptor))
	pb.RegisterAppServiceServer(server, appServer{})
	pb.RegisterTodoServiceServer(server, &todoServer{store: store})
	log.SetOutput(os.Stdout)
	log.Printf("gRPC listening on %s\n", addr)
	if err := server.Serve(lis); err != nil {
		log.Fatal(err)
	}
}
