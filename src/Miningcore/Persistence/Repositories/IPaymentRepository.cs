using System.Data;
using Miningcore.Persistence.Model;
using Miningcore.Persistence.Model.Projections;

namespace Miningcore.Persistence.Repositories;

public interface IPaymentRepository
{
    Task<long> InsertAsync(IDbConnection con, IDbTransaction tx, Payment payment);
    Task<Payment[]> GetPaymentsByStatusAsync(IDbConnection con, string poolId, params PaymentStatus[] status);
    Task UpdateStatusAsync(IDbConnection con, IDbTransaction tx, long id, PaymentStatus status, string transactionConfirmationData);
    Task DeleteAsync(IDbConnection con, IDbTransaction tx, long id);
    Task BatchInsertAsync(IDbConnection con, IDbTransaction tx, IEnumerable<Payment> shares);

    Task<Payment[]> PagePaymentsAsync(IDbConnection con, string poolId, string address, int page, int pageSize, CancellationToken ct);
    Task<BalanceChange[]> PageBalanceChangesAsync(IDbConnection con, string poolId, string address, int page, int pageSize, CancellationToken ct);
    Task<AmountByDate[]> PageMinerPaymentsByDayAsync(IDbConnection con, string poolId, string address, int page, int pageSize, CancellationToken ct);
    Task<uint> GetPaymentsCountAsync(IDbConnection con, string poolId, string address, CancellationToken ct);
    Task<uint> GetMinerPaymentsByDayCountAsync(IDbConnection con, string poolId, string address);
    Task<uint> GetBalanceChangesCountAsync(IDbConnection con, string poolId, string address = null);
}
