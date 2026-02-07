using Microsoft.EntityFrameworkCore;
using Serilog;
using Tamma.Api.Services;
using Tamma.Core.Interfaces;
using Tamma.Data;
using Tamma.Data.Repositories;

var builder = WebApplication.CreateBuilder(args);

// Configure Serilog
Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(builder.Configuration)
    .Enrich.FromLogContext()
    .WriteTo.Console()
    .WriteTo.File("logs/tamma-api-.log", rollingInterval: RollingInterval.Day)
    .CreateLogger();

builder.Host.UseSerilog();

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new Microsoft.OpenApi.Models.OpenApiInfo
    {
        Title = "Tamma Mentorship API",
        Version = "v1",
        Description = "REST API for Tamma Autonomous Mentorship Engine"
    });
});

// Configure HTTP client factory
builder.Services.AddHttpClient();

// Configure database
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("Connection string 'DefaultConnection' is not configured. Set ConnectionStrings__DefaultConnection environment variable or configure it in appsettings.json.");

builder.Services.AddDbContext<TammaDbContext>(options =>
    options.UseNpgsql(connectionString));

// Register repositories
builder.Services.AddScoped<IMentorshipSessionRepository, MentorshipSessionRepository>();

// Register services
builder.Services.AddScoped<IMentorshipService, MentorshipService>();
builder.Services.AddScoped<IIntegrationService, IntegrationService>();
builder.Services.AddScoped<IAnalyticsService, AnalyticsService>();
builder.Services.AddScoped<IElsaWorkflowService, ElsaWorkflowService>();

// Configure CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowDashboard", policy =>
    {
        policy.WithOrigins(
                builder.Configuration["Dashboard:Url"] ?? "http://localhost:3001")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

// Configure health checks
builder.Services.AddHealthChecks()
    .AddNpgSql(connectionString);

// Configure authentication
var jwtSecret = builder.Configuration["Jwt:Secret"];
if (!string.IsNullOrEmpty(jwtSecret))
{
    builder.Services.AddAuthentication("Bearer")
        .AddJwtBearer("Bearer", options =>
        {
            options.Authority = builder.Configuration["Jwt:Authority"];
            options.TokenValidationParameters = new Microsoft.IdentityModel.Tokens.TokenValidationParameters
            {
                ValidateAudience = true,
                ValidAudience = builder.Configuration["Jwt:Audience"] ?? "tamma-api",
                ValidateIssuer = true,
                ValidIssuer = builder.Configuration["Jwt:Issuer"] ?? "tamma"
            };
        });
    builder.Services.AddAuthorization();
}
else if (builder.Environment.IsDevelopment())
{
    Log.Warning("JWT secret not configured. Using permissive authorization in Development mode. " +
        "Set Jwt:Secret in configuration for production deployments.");
    // In development without JWT, register auth services with a permissive default policy
    // so [Authorize] attributes do not block requests during local development
    builder.Services.AddAuthentication();
    builder.Services.AddAuthorization(options =>
    {
        options.DefaultPolicy = new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
            .AddRequirements(new Tamma.Api.Infrastructure.AllowAnonymousRequirement())
            .Build();
    });
    builder.Services.AddSingleton<Microsoft.AspNetCore.Authorization.IAuthorizationHandler,
        Tamma.Api.Infrastructure.AllowAnonymousHandler>();
}
else
{
    throw new InvalidOperationException(
        "JWT secret (Jwt:Secret) must be configured in non-Development environments. " +
        "Authentication cannot be disabled in production.");
}

var app = builder.Build();

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "Tamma API v1");
        c.RoutePrefix = "swagger";
    });
}

app.UseSerilogRequestLogging();

app.UseHttpsRedirection();
app.UseCors("AllowDashboard");

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHealthChecks("/health");

// Ensure database is created and migrations applied
using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<TammaDbContext>();
    try
    {
        dbContext.Database.Migrate();
        Log.Information("Database migrations applied successfully");
    }
    catch (Exception ex)
    {
        Log.Warning(ex, "Error applying migrations, database may already be up to date");
    }
}

Log.Information("Tamma API starting up...");

app.Run();

// Make Program class accessible for testing
public partial class Program { }
