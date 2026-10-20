namespace Miningcore.Persistence.Model;

public enum PaymentStatus
{
    /// <summary>
    /// Taken off the balance and about to be sent. A payment that stays here was sent without
    /// the pool learning the outcome (e.g. the node timed out) and needs checking by hand.
    /// </summary>
    Sending = 1,

    /// <summary>
    /// Sent, waiting for the transaction to be mined
    /// </summary>
    Pending = 2,

    /// <summary>
    /// Mined with enough confirmations
    /// </summary>
    Confirmed = 3
}
