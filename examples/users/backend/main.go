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

	pb "users/backend/gen/examplev1"

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

func authorize(ctx context.Context) error {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return status.Error(codes.Unauthenticated, "missing metadata")
	}
	got := strings.TrimSpace(strings.Join(md.Get("authorization"), " "))
	if got != "Bearer "+authToken {
		return status.Error(codes.Unauthenticated, "invalid token")
	}
	return nil
}

func authInterceptor(
	ctx context.Context,
	req any,
	_ *grpc.UnaryServerInfo,
	handler grpc.UnaryHandler,
) (any, error) {
	if err := authorize(ctx); err != nil {
		return nil, err
	}
	return handler(ctx, req)
}

func authStreamInterceptor(
	srv any,
	ss grpc.ServerStream,
	_ *grpc.StreamServerInfo,
	handler grpc.StreamHandler,
) error {
	if err := authorize(ss.Context()); err != nil {
		return err
	}
	return handler(srv, ss)
}

type store struct {
	mu        sync.Mutex
	users     map[string]*pb.User
	issues    map[string]*pb.Issue
	teams     map[string]*pb.Team
	seq       int32
	listeners map[chan *pb.Issue]struct{}
}

func newStore() *store {
	s := &store{
		users:     map[string]*pb.User{},
		issues:    map[string]*pb.Issue{},
		teams:     map[string]*pb.Team{},
		listeners: map[chan *pb.Issue]struct{}{},
	}

	s.users["user_ada"] = &pb.User{
		Id:    proto.String("user_ada"),
		Name:  proto.String("Ada Lovelace"),
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
	s.users["user_charles"] = &pb.User{
		Id:    proto.String("user_charles"),
		Name:  proto.String("Charles Babbage"),
		Email: proto.String("charles@example.com"),
		Role:  pb.UserRole_USER_ROLE_MEMBER.Enum(),
		Tags:  []string{"engine"},
		Address: &pb.Address{
			City:    proto.String("London"),
			Country: proto.String("UK"),
		},
		CreatedAt: timestamppb.New(time.Date(1791, 12, 26, 0, 0, 0, 0, time.UTC)),
		Active:    proto.Bool(true),
		Karma:     proto.Int32(18),
		Score:     proto.Float64(81),
		Balance:   proto.Int64(240),
	}
	s.users["user_grace"] = &pb.User{
		Id:    proto.String("user_grace"),
		Name:  proto.String("Grace Hopper"),
		Email: proto.String("grace@example.com"),
		Role:  pb.UserRole_USER_ROLE_MEMBER.Enum(),
		Tags:  []string{"compiler"},
		Address: &pb.Address{
			City:    proto.String("New York"),
			Country: proto.String("US"),
		},
		CreatedAt: timestamppb.New(time.Date(1906, 12, 9, 0, 0, 0, 0, time.UTC)),
		Active:    proto.Bool(true),
		Karma:     proto.Int32(31),
		Score:     proto.Float64(94),
		Balance:   proto.Int64(640),
	}

	s.teams["team_eng"] = &pb.Team{
		Id:          proto.String("team_eng"),
		Key:         proto.String("ENG"),
		Name:        proto.String("Engineering"),
		Description: proto.String("gRPC hop, codecs, live streams."),
		MemberIds:   []string{"user_ada", "user_charles"},
		CreatedAt:   timestamppb.New(time.Date(2024, 1, 8, 0, 0, 0, 0, time.UTC)),
	}
	s.teams["team_core"] = &pb.Team{
		Id:          proto.String("team_core"),
		Key:         proto.String("CORE"),
		Name:        proto.String("Platform"),
		Description: proto.String("Auth, workspace, proto schema."),
		MemberIds:   []string{"user_ada", "user_grace"},
		CreatedAt:   timestamppb.New(time.Date(2024, 3, 2, 0, 0, 0, 0, time.UTC)),
	}
	s.teams["team_lab"] = &pb.Team{
		Id:          proto.String("team_lab"),
		Key:         proto.String("LAB"),
		Name:        proto.String("Labs"),
		Description: proto.String("Experiments that might ship."),
		MemberIds:   []string{"user_grace", "user_charles"},
		CreatedAt:   timestamppb.New(time.Date(2025, 6, 1, 0, 0, 0, 0, time.UTC)),
	}

	seed := []struct {
		title, desc, assignee, team string
		status                      pb.IssueStatus
		priority                    pb.IssuePriority
		daysAgo                     int
	}{
		{"Wire gRPC-Web hop for the browser", "Unary + server-streaming through the hop.", "user_ada", "team_eng", pb.IssueStatus_ISSUE_STATUS_IN_PROGRESS, pb.IssuePriority_ISSUE_PRIORITY_URGENT, 4},
		{"Auth interceptor on every RPC", "Bearer must match the dashboard token.", "user_charles", "team_core", pb.IssueStatus_ISSUE_STATUS_TODO, pb.IssuePriority_ISSUE_PRIORITY_HIGH, 3},
		{"Workspace labels from live stats", "Surface org.workspace.stats in the rail.", "user_grace", "team_core", pb.IssueStatus_ISSUE_STATUS_BACKLOG, pb.IssuePriority_ISSUE_PRIORITY_LOW, 8},
		{"Live issue.onChange stream", "Push creates and updates to every subscriber.", "user_ada", "team_eng", pb.IssueStatus_ISSUE_STATUS_IN_PROGRESS, pb.IssuePriority_ISSUE_PRIORITY_MEDIUM, 1},
		{"Command palette for issues", "Keyboard-first create and jump.", "user_grace", "team_lab", pb.IssueStatus_ISSUE_STATUS_DONE, pb.IssuePriority_ISSUE_PRIORITY_LOW, 12},
		{"Invite the next operator", "user.create should land in People instantly.", "", "team_lab", pb.IssueStatus_ISSUE_STATUS_TODO, pb.IssuePriority_ISSUE_PRIORITY_NONE, 2},
	}
	for _, row := range seed {
		s.seq++
		id := issueID(s.seq)
		issue := &pb.Issue{
			Id:          proto.String(id),
			Number:      proto.Int32(s.seq),
			Title:       proto.String(row.title),
			Description: proto.String(row.desc),
			Status:      row.status.Enum(),
			Priority:    row.priority.Enum(),
			TeamId:      proto.String(row.team),
			CreatedAt:   timestamppb.New(time.Now().UTC().Add(-time.Duration(row.daysAgo) * 24 * time.Hour)),
		}
		if row.assignee != "" {
			issue.AssigneeId = proto.String(row.assignee)
		}
		s.issues[id] = issue
	}
	return s
}

func issueID(n int32) string {
	return "AE-" + itoa(n)
}


func itoa(n int32) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return time.Now().UTC().Format("user_20060102150405.000000000")
	}
	return "user_" + hex.EncodeToString(b[:])
}

func teamID(key string) string {
	return "team_" + strings.ToLower(strings.TrimSpace(key))
}

func hasID(ids []string, id string) bool {
	for _, item := range ids {
		if item == id {
			return true
		}
	}
	return false
}

func (s *store) listen() chan *pb.Issue {
	ch := make(chan *pb.Issue, 16)
	s.mu.Lock()
	s.listeners[ch] = struct{}{}
	s.mu.Unlock()
	return ch
}

func (s *store) unlisten(ch chan *pb.Issue) {
	s.mu.Lock()
	delete(s.listeners, ch)
	s.mu.Unlock()
}

func (s *store) publish(issue *pb.Issue) {
	clone := proto.Clone(issue).(*pb.Issue)
	s.mu.Lock()
	listeners := make([]chan *pb.Issue, 0, len(s.listeners))
	for ch := range s.listeners {
		listeners = append(listeners, ch)
	}
	s.mu.Unlock()
	for _, ch := range listeners {
		select {
		case ch <- clone:
		default:
		}
	}
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

func (appServer) Hello(_ context.Context, req *pb.AppHelloRequest) (*pb.AppHelloResponse, error) {
	return &pb.AppHelloResponse{
		Message: proto.String("hello " + req.GetFullName()),
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

func (s *userServer) Update(_ context.Context, req *pb.UserUpdateRequest) (*pb.User, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	user, ok := s.store.users[req.GetId()]
	if !ok {
		return nil, status.Error(codes.NotFound, req.GetId())
	}
	if req.Name != nil {
		user.Name = proto.String(req.GetName())
	}
	if req.Email != nil {
		user.Email = proto.String(req.GetEmail())
	}
	if req.Role != nil {
		user.Role = req.GetRole().Enum()
	}
	if req.Tags != nil {
		user.Tags = append([]string{}, req.GetTags()...)
	}
	if req.Address != nil {
		user.Address = req.GetAddress()
	}
	if req.Active != nil {
		user.Active = proto.Bool(req.GetActive())
	}
	return cloneUser(user), nil
}

type orgServer struct {
	pb.UnimplementedOrgWorkspaceServiceServer
	store *store
}

func (s *orgServer) Stats(context.Context, *emptypb.Empty) (*pb.WorkspaceStats, error) {
	s.store.mu.Lock()
	n := len(s.store.users)
	labels := map[string]int32{
		"backlog":     0,
		"todo":        0,
		"in_progress": 0,
		"done":        0,
		"teams":       int32(len(s.store.teams)),
	}
	for _, issue := range s.store.issues {
		switch issue.GetStatus() {
		case pb.IssueStatus_ISSUE_STATUS_BACKLOG:
			labels["backlog"]++
		case pb.IssueStatus_ISSUE_STATUS_TODO:
			labels["todo"]++
		case pb.IssueStatus_ISSUE_STATUS_IN_PROGRESS:
			labels["in_progress"]++
		case pb.IssueStatus_ISSUE_STATUS_DONE:
			labels["done"]++
		}
	}
	s.store.mu.Unlock()
	return &pb.WorkspaceStats{
		Name:   proto.String("analytical-engine"),
		Users:  proto.Int32(int32(n)),
		Labels: labels,
	}, nil
}

type issueServer struct {
	pb.UnimplementedIssueServiceServer
	store *store
}

func (s *issueServer) GetById(_ context.Context, req *pb.IssueGetByIdRequest) (*pb.Issue, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	issue, ok := s.store.issues[req.GetId()]
	if !ok {
		return nil, status.Error(codes.NotFound, req.GetId())
	}
	return cloneIssue(issue), nil
}

func (s *issueServer) List(_ context.Context, req *pb.IssueListRequest) (*pb.IssueListResponse, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	q := strings.ToLower(req.GetQ())
	items := make([]*pb.Issue, 0, len(s.store.issues))
	for _, issue := range s.store.issues {
		if q != "" {
			title := strings.ToLower(issue.GetTitle())
			desc := strings.ToLower(issue.GetDescription())
			id := strings.ToLower(issue.GetId())
			if !strings.Contains(title, q) && !strings.Contains(desc, q) && !strings.Contains(id, q) {
				continue
			}
		}
		if req.Status != nil && issue.GetStatus() != req.GetStatus() {
			continue
		}
		if req.AssigneeId != nil && issue.GetAssigneeId() != req.GetAssigneeId() {
			continue
		}
		if req.TeamId != nil && issue.GetTeamId() != req.GetTeamId() {
			continue
		}
		items = append(items, cloneIssue(issue))
	}
	for i := 0; i < len(items); i++ {
		for j := i + 1; j < len(items); j++ {
			if items[j].GetNumber() > items[i].GetNumber() {
				items[i], items[j] = items[j], items[i]
			}
		}
	}
	return &pb.IssueListResponse{
		Items: items,
		Total: proto.Int32(int32(len(items))),
	}, nil
}

func (s *issueServer) Create(_ context.Context, req *pb.IssueCreateRequest) (*pb.Issue, error) {
	statusVal := pb.IssueStatus_ISSUE_STATUS_TODO
	if req.Status != nil {
		statusVal = req.GetStatus()
	}
	priority := pb.IssuePriority_ISSUE_PRIORITY_NONE
	if req.Priority != nil {
		priority = req.GetPriority()
	}
	s.store.mu.Lock()
	s.store.seq++
	n := s.store.seq
	id := issueID(n)
	issue := &pb.Issue{
		Id:          proto.String(id),
		Number:      proto.Int32(n),
		Title:       proto.String(req.GetTitle()),
		Description: proto.String(req.GetDescription()),
		Status:      statusVal.Enum(),
		Priority:    priority.Enum(),
		CreatedAt:   timestamppb.Now(),
	}
	if req.AssigneeId != nil {
		issue.AssigneeId = proto.String(req.GetAssigneeId())
	}
	if req.TeamId != nil {
		issue.TeamId = proto.String(req.GetTeamId())
	}
	s.store.issues[id] = issue
	out := cloneIssue(issue)
	s.store.mu.Unlock()
	s.store.publish(out)
	return out, nil
}

func (s *issueServer) Update(_ context.Context, req *pb.IssueUpdateRequest) (*pb.Issue, error) {
	s.store.mu.Lock()
	issue, ok := s.store.issues[req.GetId()]
	if !ok {
		s.store.mu.Unlock()
		return nil, status.Error(codes.NotFound, req.GetId())
	}
	if req.Title != nil {
		issue.Title = proto.String(req.GetTitle())
	}
	if req.Description != nil {
		issue.Description = proto.String(req.GetDescription())
	}
	if req.Status != nil {
		issue.Status = req.GetStatus().Enum()
	}
	if req.Priority != nil {
		issue.Priority = req.GetPriority().Enum()
	}
	if req.AssigneeId != nil {
		issue.AssigneeId = proto.String(req.GetAssigneeId())
	}
	if req.TeamId != nil {
		issue.TeamId = proto.String(req.GetTeamId())
	}
	out := cloneIssue(issue)
	s.store.mu.Unlock()
	s.store.publish(out)
	return out, nil
}

func (s *issueServer) OnChange(_ *pb.IssueOnChangeRequest, stream pb.IssueService_OnChangeServer) error {
	ch := s.store.listen()
	defer s.store.unlisten(ch)
	ctx := stream.Context()
	for {
		select {
		case <-ctx.Done():
			return nil
		case issue := <-ch:
			if err := stream.Send(issue); err != nil {
				return err
			}
		}
	}
}

type teamServer struct {
	pb.UnimplementedTeamServiceServer
	store *store
}

func (s *teamServer) GetById(_ context.Context, req *pb.TeamGetByIdRequest) (*pb.Team, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	team, ok := s.store.teams[req.GetId()]
	if !ok {
		return nil, status.Error(codes.NotFound, req.GetId())
	}
	return cloneTeam(team), nil
}

func (s *teamServer) List(_ context.Context, req *pb.TeamListRequest) (*pb.TeamListResponse, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	q := strings.ToLower(req.GetQ())
	items := make([]*pb.Team, 0, len(s.store.teams))
	for _, team := range s.store.teams {
		if q != "" {
			name := strings.ToLower(team.GetName())
			key := strings.ToLower(team.GetKey())
			if !strings.Contains(name, q) && !strings.Contains(key, q) {
				continue
			}
		}
		items = append(items, cloneTeam(team))
	}
	return &pb.TeamListResponse{
		Items: items,
		Total: proto.Int32(int32(len(items))),
	}, nil
}

func (s *teamServer) Create(_ context.Context, req *pb.TeamCreateRequest) (*pb.Team, error) {
	key := strings.ToUpper(strings.TrimSpace(req.GetKey()))
	id := teamID(key)
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	if _, exists := s.store.teams[id]; exists {
		return nil, status.Error(codes.AlreadyExists, key)
	}
	team := &pb.Team{
		Id:          proto.String(id),
		Key:         proto.String(key),
		Name:        proto.String(req.GetName()),
		Description: proto.String(req.GetDescription()),
		MemberIds:   append([]string{}, req.GetMemberIds()...),
		CreatedAt:   timestamppb.Now(),
	}
	s.store.teams[id] = team
	return cloneTeam(team), nil
}

func (s *teamServer) Update(_ context.Context, req *pb.TeamUpdateRequest) (*pb.Team, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	team, ok := s.store.teams[req.GetId()]
	if !ok {
		return nil, status.Error(codes.NotFound, req.GetId())
	}
	if req.Key != nil {
		team.Key = proto.String(strings.ToUpper(req.GetKey()))
	}
	if req.Name != nil {
		team.Name = proto.String(req.GetName())
	}
	if req.Description != nil {
		team.Description = proto.String(req.GetDescription())
	}
	if req.MemberIds != nil {
		team.MemberIds = append([]string{}, req.GetMemberIds()...)
	}
	return cloneTeam(team), nil
}

func (s *teamServer) AddMember(_ context.Context, req *pb.TeamAddMemberRequest) (*pb.Team, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	team, ok := s.store.teams[req.GetTeamId()]
	if !ok {
		return nil, status.Error(codes.NotFound, req.GetTeamId())
	}
	if _, ok := s.store.users[req.GetUserId()]; !ok {
		return nil, status.Error(codes.NotFound, req.GetUserId())
	}
	if !hasID(team.MemberIds, req.GetUserId()) {
		team.MemberIds = append(team.MemberIds, req.GetUserId())
	}
	return cloneTeam(team), nil
}

func (s *teamServer) RemoveMember(_ context.Context, req *pb.TeamAddMemberRequest) (*pb.Team, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	team, ok := s.store.teams[req.GetTeamId()]
	if !ok {
		return nil, status.Error(codes.NotFound, req.GetTeamId())
	}
	next := make([]string, 0, len(team.MemberIds))
	for _, id := range team.MemberIds {
		if id != req.GetUserId() {
			next = append(next, id)
		}
	}
	team.MemberIds = next
	return cloneTeam(team), nil
}

func cloneUser(user *pb.User) *pb.User {
	return proto.Clone(user).(*pb.User)
}

func cloneIssue(issue *pb.Issue) *pb.Issue {
	return proto.Clone(issue).(*pb.Issue)
}

func cloneTeam(team *pb.Team) *pb.Team {
	return proto.Clone(team).(*pb.Team)
}

func main() {
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatal(err)
	}
	store := newStore()
	server := grpc.NewServer(
		grpc.UnaryInterceptor(authInterceptor),
		grpc.StreamInterceptor(authStreamInterceptor),
	)
	pb.RegisterAppServiceServer(server, appServer{})
	pb.RegisterUserServiceServer(server, &userServer{store: store})
	pb.RegisterOrgWorkspaceServiceServer(server, &orgServer{store: store})
	pb.RegisterIssueServiceServer(server, &issueServer{store: store})
	pb.RegisterTeamServiceServer(server, &teamServer{store: store})
	log.SetOutput(os.Stdout)
	log.Printf("gRPC listening on %s\n", addr)
	if err := server.Serve(lis); err != nil {
		log.Fatal(err)
	}
}
