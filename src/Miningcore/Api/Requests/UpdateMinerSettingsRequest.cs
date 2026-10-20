using Miningcore.Api.Responses;

namespace Miningcore.Api.Requests;

public class UpdateMinerSettingsRequest
{
    public MinerSettings Settings { get; set; }
}
