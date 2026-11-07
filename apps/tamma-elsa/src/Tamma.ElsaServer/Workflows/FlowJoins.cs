using Elsa.Workflows;
using Elsa.Workflows.Activities.Flowchart.Activities;
using Elsa.Workflows.Activities.Flowchart.Models;
using Elsa.Workflows.Models;
using Endpoint = Elsa.Workflows.Activities.Flowchart.Models.Endpoint;

namespace Tamma.ElsaServer.Workflows;

/// <summary>
/// Makes flowchart convergence points explicit.
///
/// <para><b>Why:</b> in Elsa 3.5 a flowchart node with more than one forward inbound
/// connection is an IMPLICIT join in <c>WaitAllActive</c> mode: it runs only after
/// EVERY inbound connection has been visited (followed, or reached by skip
/// propagation). When the inbound branches are mutually exclusive and one of them sits
/// behind a loop or a suspend, skip propagation never reaches it, so the node never
/// runs — the flowchart then sees no pending work and completes SILENTLY, with none of
/// the downstream outputs set. <c>DocumentLifecycleWorkflow</c>'s escalation terminal
/// did exactly this: a validation-exhausted run finished with an empty output instead
/// of <c>status=escalated</c>.</para>
///
/// <para><see cref="WaitAny"/> reroutes each target's forward inbound connections through
/// an explicit <see cref="FlowJoin"/> in <see cref="FlowJoinMode.WaitAny"/> mode, which
/// proceeds on the first followed branch. Use it only where the inbound branches are
/// mutually exclusive (WaitAny cancels inbound ancestors that are still running).
/// Backward (loop) connections are left as they are.</para>
/// </summary>
public static class FlowJoins
{
    public static void WaitAny(Flowchart flowchart, params IActivity[] targets)
    {
        var graph = new FlowGraph(flowchart.Connections, flowchart.Start);
        foreach (var target in targets)
        {
            var inbound = graph.GetForwardInboundConnections(target);
            if (inbound.Count < 2)
                throw new InvalidOperationException(
                    $"'{target.Id}' has {inbound.Count} forward inbound connection(s); a WaitAny join needs at least 2.");

            var join = new FlowJoin
            {
                Id = target.Id + "Join",
                Name = (target.Name ?? target.Id) + " (any branch)",
                Mode = new Input<FlowJoinMode>(FlowJoinMode.WaitAny),
            };
            flowchart.Activities.Add(join);
            foreach (var c in inbound)
            {
                flowchart.Connections.Remove(c);
                flowchart.Connections.Add(new Connection(c.Source, new Endpoint(join)));
            }
            flowchart.Connections.Add(new Connection(new Endpoint(join), new Endpoint(target)));
        }
    }
}
