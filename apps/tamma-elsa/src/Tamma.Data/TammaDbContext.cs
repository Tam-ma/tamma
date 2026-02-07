using Microsoft.EntityFrameworkCore;
using Tamma.Core.Entities;
using Tamma.Core.Enums;

namespace Tamma.Data;

/// <summary>
/// Entity Framework database context for Tamma
/// </summary>
public class TammaDbContext : DbContext
{
    public TammaDbContext(DbContextOptions<TammaDbContext> options)
        : base(options)
    {
    }

    public DbSet<MentorshipSession> MentorshipSessions => Set<MentorshipSession>();
    public DbSet<MentorshipEvent> MentorshipEvents => Set<MentorshipEvent>();
    public DbSet<JuniorDeveloper> JuniorDevelopers => Set<JuniorDeveloper>();
    public DbSet<Story> Stories => Set<Story>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // MentorshipSession configuration
        modelBuilder.Entity<MentorshipSession>(entity =>
        {
            entity.ToTable("mentorship_sessions");

            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id)
                .HasColumnName("id")
                .HasDefaultValueSql("uuid_generate_v4()");

            entity.Property(e => e.StoryId)
                .HasColumnName("story_id")
                .IsRequired();

            entity.Property(e => e.JuniorId)
                .HasColumnName("junior_id")
                .IsRequired();

            entity.Property(e => e.CurrentState)
                .HasColumnName("current_state")
                .HasConversion<string>()
                .IsRequired();

            entity.Property(e => e.PreviousState)
                .HasColumnName("previous_state")
                .HasConversion<string>();

            entity.Property(e => e.Context)
                .HasColumnName("context")
                .HasColumnType("jsonb");

            entity.Property(e => e.Variables)
                .HasColumnName("variables")
                .HasColumnType("jsonb");

            entity.Property(e => e.WorkflowInstanceId)
                .HasColumnName("workflow_instance_id");

            entity.Property(e => e.CreatedAt)
                .HasColumnName("created_at")
                .HasDefaultValueSql("now()");

            entity.Property(e => e.UpdatedAt)
                .HasColumnName("updated_at")
                .HasDefaultValueSql("now()");

            entity.Property(e => e.CompletedAt)
                .HasColumnName("completed_at");

            entity.Property(e => e.Status)
                .HasColumnName("status")
                .HasConversion<string>()
                .HasDefaultValue(SessionStatus.Active);

            entity.Property(e => e.RowVersion)
                .HasColumnName("row_version")
                .IsRowVersion();

            // Indexes
            entity.HasIndex(e => e.JuniorId);
            entity.HasIndex(e => e.StoryId);
            entity.HasIndex(e => e.CurrentState);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.CreatedAt);
            entity.HasIndex(e => e.WorkflowInstanceId);

            // Relationships
            entity.HasOne(e => e.Junior)
                .WithMany(j => j.Sessions)
                .HasForeignKey(e => e.JuniorId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Story)
                .WithMany(s => s.Sessions)
                .HasForeignKey(e => e.StoryId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        // MentorshipEvent configuration
        modelBuilder.Entity<MentorshipEvent>(entity =>
        {
            entity.ToTable("mentorship_events");

            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id)
                .HasColumnName("id")
                .HasDefaultValueSql("uuid_generate_v4()");

            entity.Property(e => e.SessionId)
                .HasColumnName("session_id")
                .IsRequired();

            entity.Property(e => e.EventType)
                .HasColumnName("event_type")
                .IsRequired();

            entity.Property(e => e.EventData)
                .HasColumnName("event_data")
                .HasColumnType("jsonb");

            entity.Property(e => e.StateFrom)
                .HasColumnName("state_from")
                .HasConversion<string>();

            entity.Property(e => e.StateTo)
                .HasColumnName("state_to")
                .HasConversion<string>();

            entity.Property(e => e.Trigger)
                .HasColumnName("trigger");

            entity.Property(e => e.CreatedAt)
                .HasColumnName("created_at")
                .HasDefaultValueSql("now()");

            // Indexes
            entity.HasIndex(e => e.SessionId);
            entity.HasIndex(e => e.EventType);
            entity.HasIndex(e => e.CreatedAt);

            // Relationships
            entity.HasOne(e => e.Session)
                .WithMany(s => s.Events)
                .HasForeignKey(e => e.SessionId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // JuniorDeveloper configuration
        modelBuilder.Entity<JuniorDeveloper>(entity =>
        {
            entity.ToTable("junior_developers");

            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id)
                .HasColumnName("id");

            entity.Property(e => e.Name)
                .HasColumnName("name")
                .IsRequired();

            entity.Property(e => e.Email)
                .HasColumnName("email");

            entity.Property(e => e.SlackId)
                .HasColumnName("slack_id");

            entity.Property(e => e.GitHubUsername)
                .HasColumnName("github_username");

            entity.Property(e => e.SkillLevel)
                .HasColumnName("skill_level")
                .HasDefaultValue(1);

            entity.Property(e => e.Preferences)
                .HasColumnName("preferences")
                .HasColumnType("jsonb");

            entity.Property(e => e.LearningPatterns)
                .HasColumnName("learning_patterns")
                .HasColumnType("jsonb");

            entity.Property(e => e.TotalSessions)
                .HasColumnName("total_sessions")
                .HasDefaultValue(0);

            entity.Property(e => e.SuccessfulSessions)
                .HasColumnName("successful_sessions")
                .HasDefaultValue(0);

            entity.Property(e => e.CreatedAt)
                .HasColumnName("created_at")
                .HasDefaultValueSql("now()");

            entity.Property(e => e.UpdatedAt)
                .HasColumnName("updated_at")
                .HasDefaultValueSql("now()");

            // Indexes
            entity.HasIndex(e => e.Email);
            entity.HasIndex(e => e.GitHubUsername);
            entity.HasIndex(e => e.SkillLevel);
        });

        // Story configuration
        modelBuilder.Entity<Story>(entity =>
        {
            entity.ToTable("stories");

            entity.HasKey(e => e.Id);

            entity.Property(e => e.Id)
                .HasColumnName("id");

            entity.Property(e => e.Title)
                .HasColumnName("title")
                .IsRequired();

            entity.Property(e => e.Description)
                .HasColumnName("description");

            entity.Property(e => e.AcceptanceCriteria)
                .HasColumnName("acceptance_criteria")
                .HasColumnType("jsonb");

            entity.Property(e => e.TechnicalRequirements)
                .HasColumnName("technical_requirements")
                .HasColumnType("jsonb");

            entity.Property(e => e.Priority)
                .HasColumnName("priority")
                .HasDefaultValue(3);

            entity.Property(e => e.Complexity)
                .HasColumnName("complexity")
                .HasDefaultValue(3);

            entity.Property(e => e.EstimatedHours)
                .HasColumnName("estimated_hours");

            entity.Property(e => e.Tags)
                .HasColumnName("tags");

            entity.Property(e => e.RepositoryUrl)
                .HasColumnName("repository_url");

            entity.Property(e => e.CreatedAt)
                .HasColumnName("created_at")
                .HasDefaultValueSql("now()");

            entity.Property(e => e.UpdatedAt)
                .HasColumnName("updated_at")
                .HasDefaultValueSql("now()");

            // Indexes
            entity.HasIndex(e => e.Priority);
            entity.HasIndex(e => e.Complexity);
        });
    }
}
