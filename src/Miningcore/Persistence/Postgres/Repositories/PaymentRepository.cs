using System.Data;
using System.Text;
using Dapper;
using Miningcore.Persistence.Model;
using Miningcore.Persistence.Model.Projections;
using Miningcore.Persistence.Repositories;
using Npgsql;
using NpgsqlTypes;

namespace Miningcore.Persistence.Postgres.Repositories;

public class PaymentRepository : IPaymentRepository
{
    public async Task<long> InsertAsync(IDbConnection con, IDbTransaction tx, Payment payment)
    {
        var mapped = payment.ToEntity();

        const string query = @"INSERT INTO payments(poolid, coin, address, amount, transactionconfirmationdata, created, status)
            VALUES(@poolid, @coin, @address, @amount, @transactionconfirmationdata, @created, @status)
            RETURNING id";

        return await con.ExecuteScalarAsync<long>(query, mapped, tx);
    }

    public async Task<Payment[]> GetPaymentsByStatusAsync(IDbConnection con, string poolId, params PaymentStatus[] status)
    {
        const string query = "SELECT * FROM payments WHERE poolid = @poolId AND status = ANY(@status) ORDER BY created";

        return (await con.QueryAsync<Entities.Payment>(query, new
            {
                poolId,
                status = status.Select(x => x.ToString().ToLower()).ToArray()
            }))
            .Select(x => x.ToModel())
            .ToArray();
    }

    public Task UpdateStatusAsync(IDbConnection con, IDbTransaction tx, long id, PaymentStatus status, string transactionConfirmationData)
    {
        const string query = "UPDATE payments SET status = @status, transactionconfirmationdata = @transactionConfirmationData WHERE id = @id";

        return con.ExecuteAsync(query, new { id, status = status.ToString().ToLower(), transactionConfirmationData }, tx);
    }

    public Task DeleteAsync(IDbConnection con, IDbTransaction tx, long id)
    {
        return con.ExecuteAsync("DELETE FROM payments WHERE id = @id", new { id }, tx);
    }

    public async Task BatchInsertAsync(IDbConnection con, IDbTransaction tx, IEnumerable<Payment> payments)
    {
        // NOTE: Even though the tx parameter is completely ignored here,
        // the COPY command still honors a current ambient transaction

        var pgCon = (NpgsqlConnection) con;

        const string query = @"COPY payments (poolid, coin, address, amount, transactionconfirmationdata, created, status) FROM STDIN (FORMAT BINARY)";

        await using(var writer = await pgCon.BeginBinaryImportAsync(query))
        {
            foreach(var payment in payments)
            {
                await writer.StartRowAsync();

                await writer.WriteAsync(payment.PoolId);
                await writer.WriteAsync(payment.Coin);
                await writer.WriteAsync(payment.Address);
                await writer.WriteAsync(payment.Amount, NpgsqlDbType.Numeric);
                await writer.WriteAsync(payment.TransactionConfirmationData);
                await writer.WriteAsync(payment.Created, NpgsqlDbType.Timestamp);
                await writer.WriteAsync(payment.Status.ToString().ToLower());
            }

            await writer.CompleteAsync();
        }
    }

    public async Task<Payment[]> PagePaymentsAsync(IDbConnection con, string poolId, string address, int page, int pageSize, CancellationToken ct)
    {
        var query = new StringBuilder("SELECT * FROM payments WHERE poolid = @poolid ");

        if(!string.IsNullOrEmpty(address))
            query.Append(" AND address = @address ");

        query.Append("ORDER BY created DESC OFFSET @offset FETCH NEXT @pageSize ROWS ONLY");

        return (await con.QueryAsync<Entities.Payment>(new CommandDefinition(query.ToString(),
                new { poolId, address, offset = page * pageSize, pageSize }, cancellationToken: ct)))
            .Select(x => x.ToModel())
            .ToArray();
    }

    public async Task<BalanceChange[]> PageBalanceChangesAsync(IDbConnection con, string poolId, string address, int page, int pageSize, CancellationToken ct)
    {
       const string query = @"SELECT * FROM balance_changes WHERE poolid = @poolid
            AND address = @address
            ORDER BY created DESC OFFSET @offset FETCH NEXT @pageSize ROWS ONLY";

        return (await con.QueryAsync<Entities.BalanceChange>(new CommandDefinition(query,
                new { poolId, address, offset = page * pageSize, pageSize }, cancellationToken: ct)))
            .Select(x => x.ToModel())
            .ToArray();
    }

    public async Task<AmountByDate[]> PageMinerPaymentsByDayAsync(IDbConnection con, string poolId, string address, int page, int pageSize, CancellationToken ct)
    {
       const string query = @"SELECT SUM(amount) AS amount, date_trunc('day', created) AS date FROM payments WHERE poolid = @poolid
            AND address = @address
            GROUP BY date
            ORDER BY date DESC OFFSET @offset FETCH NEXT @pageSize ROWS ONLY";

        return (await con.QueryAsync<AmountByDate>(new CommandDefinition(query, new { poolId, address, offset = page * pageSize, pageSize }, cancellationToken: ct)))
            .ToArray();
    }

    public Task<uint> GetPaymentsCountAsync(IDbConnection con, string poolId, string address, CancellationToken ct)
    {
        var query = new StringBuilder("SELECT COUNT(*) FROM payments WHERE poolid = @poolId");

        if(!string.IsNullOrEmpty(address))
            query.Append(" AND address = @address ");

        return con.ExecuteScalarAsync<uint>(new CommandDefinition(query.ToString(), new { poolId, address }, cancellationToken: ct));
    }

    public Task<uint> GetMinerPaymentsByDayCountAsync(IDbConnection con, string poolId, string address)
    {
        const string query =
            @"SELECT COUNT(*) FROM (SELECT SUM(amount) AS amount, date_trunc('day', created) AS date FROM payments WHERE poolid = @poolid
            AND address = @address
            GROUP BY date
            ORDER BY date DESC) s";

        return con.ExecuteScalarAsync<uint>(query, new { poolId, address });
    }

    public Task<uint> GetBalanceChangesCountAsync(IDbConnection con, string poolId, string address = null)
    {
        var query = new StringBuilder("SELECT COUNT(*) FROM balance_changes WHERE poolid = @poolId");

        if(!string.IsNullOrEmpty(address))
            query.Append(" AND address = @address ");

        return con.ExecuteScalarAsync<uint>(query.ToString(), new { poolId, address });
    }
}
