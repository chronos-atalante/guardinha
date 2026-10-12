import { describe, expect, it } from 'vitest';
import { buildOtpAuthUri, parseOtpAuthUri } from '@zero/shared/otpauth';

/**
 * O formato `otpauth://` é o que os serviços entregam quando o usuário escolhe
 * "não posso escanear agora". Um parser permissivo demais aqui vira um token
 * silenciosamente errado na tela; um restritivo demais vira "código inválido"
 * num serviço que estava certo. Estes testes travam os dois lados.
 */

const STRONG_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const GITHUB = `otpauth://totp/GitHub:alice@github.com?secret=${STRONG_SECRET}&issuer=GitHub`;

describe('parseOtpAuthUri', () => {
  it('lê o exemplo da wiki do Google Authenticator', () => {
    expect(parseOtpAuthUri(GITHUB)).toEqual({
      issuer: 'GitHub',
      account: 'alice@github.com',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: STRONG_SECRET,
    });
  });

  it('aplica os padrões quando o serviço omite os parâmetros', () => {
    const parsed = parseOtpAuthUri(`otpauth://totp/morgan?secret=${STRONG_SECRET}`);
    // SHA1, 6 dígitos, 30 s: o que GitHub, Discord, Google e AWS usam
    expect(parsed?.algorithm).toBe('SHA1');
    expect(parsed?.digits).toBe(6);
    expect(parsed?.period).toBe(30);
    expect(parsed?.secret).toBe(STRONG_SECRET);
  });

  it('aceita SHA256 e SHA512, os poucos serviços que pedem', () => {
    expect(
      parseOtpAuthUri(`otpauth://totp/Azure:me?secret=${STRONG_SECRET}&algorithm=sha256`)
        ?.algorithm,
    ).toBe('SHA256');
    expect(
      parseOtpAuthUri(`otpauth://totp/OAuth:me?secret=${STRONG_SECRET}&algorithm=SHA512`)
        ?.algorithm,
    ).toBe('SHA512');
  });

  it('aceita 8 dígitos e período de 60 s', () => {
    const parsed = parseOtpAuthUri(
      `otpauth://totp/Servico:me?secret=${STRONG_SECRET}&digits=8&period=60`,
    );
    expect(parsed?.digits).toBe(8);
    expect(parsed?.period).toBe(60);
  });

  it('toma o emissor do prefixo do rótulo quando não vem o parâmetro', () => {
    // é o que o Google Authenticator antigo faz, e o motivo de o formato
    // pedir os dois em concordância
    expect(parseOtpAuthUri(`otpauth://totp/Discord:morgan#4321?secret=${STRONG_SECRET}`)).toEqual({
      issuer: 'Discord',
      account: 'morgan#4321',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: STRONG_SECRET,
    });
  });

  it('normaliza a chave colada com espaços e minúsculas', () => {
    expect(
      parseOtpAuthUri(
        `otpauth://totp/Site:eu?secret=gezd gnbv gy3t qojq gezd gnbv gy3t qojq&issuer=Site`,
      )?.secret,
    ).toBe(STRONG_SECRET);
  });

  it('preserva campos do rótulo cujo escape percentual está malformado', () => {
    expect(parseOtpAuthUri(`otpauth://totp/%ZZ:conta%?secret=${STRONG_SECRET}`)).toMatchObject({
      issuer: '%ZZ',
      account: 'conta%',
    });
  });

  it('recusa emissor que não bate com o rótulo', () => {
    // sinal de endereço remontado ou colado de dois serviços: melhor recusar
    expect(
      parseOtpAuthUri(`otpauth://totp/GitHub:eu?secret=${STRONG_SECRET}&issuer=Discord`),
    ).toBeNull();
  });

  it('recusa esquema, tipo e endereço que não são do formato', () => {
    expect(parseOtpAuthUri('https://exemplo.com/2fa')).toBeNull();
    expect(parseOtpAuthUri(`otpauth://hotp/Banco:eu?secret=${STRONG_SECRET}&counter=1`)).toBeNull();
    expect(parseOtpAuthUri('lixo')).toBeNull();
    expect(parseOtpAuthUri('')).toBeNull();
  });

  it('recusa segredo ausente, curto ou fora do alfabeto base32', () => {
    expect(parseOtpAuthUri('otpauth://totp/Site:eu')).toBeNull();
    expect(parseOtpAuthUri('otpauth://totp/Site:eu?secret=')).toBeNull();
    expect(parseOtpAuthUri('otpauth://totp/Site:eu?secret=JBSWY3DP1EHPK3PXP')).toBeNull();
    expect(parseOtpAuthUri('otpauth://totp/Site:eu?secret=JBSWY3DPEHPK3PXP')).toBeNull();
    expect(parseOtpAuthUri('otpauth://totp/Site:eu?secret=AA')).toBeNull();
    expect(parseOtpAuthUri(`otpauth://totp/Site:eu?secret=${'A'.repeat(25)}`)).toBeNull();
  });

  it('aceita o limite mínimo exato de 128 bits (16 bytes)', () => {
    const secret = 'A'.repeat(26);
    expect(parseOtpAuthUri(`otpauth://totp/Site:eu?secret=${secret}`)?.secret).toBe(secret);
  });

  it('recusa parâmetro repetido, em vez de escolher um dos dois', () => {
    expect(
      parseOtpAuthUri(`otpauth://totp/Site:eu?secret=${STRONG_SECRET}&digits=6&digits=8`),
    ).toBeNull();
  });

  it('recusa parâmetro fora da faixa em vez de gerar um token estranho', () => {
    expect(parseOtpAuthUri(`otpauth://totp/Site:eu?secret=${STRONG_SECRET}&digits=7`)).toBeNull();
    expect(parseOtpAuthUri(`otpauth://totp/Site:eu?secret=${STRONG_SECRET}&period=0`)).toBeNull();
    expect(
      parseOtpAuthUri(`otpauth://totp/Site:eu?secret=${STRONG_SECRET}&algorithm=MD5`),
    ).toBeNull();
  });

  it('recusa endereço sem conta nem emissor', () => {
    expect(parseOtpAuthUri(`otpauth://totp/?secret=${STRONG_SECRET}`)).toBeNull();
  });
});

describe('buildOtpAuthUri', () => {
  it('é o inverso exato do parser, para exportar e reler', () => {
    const parsed = parseOtpAuthUri(GITHUB);
    expect(parsed).not.toBeNull();
    if (parsed === null) throw new Error('o exemplo da wiki deveria ter parseado');
    expect(parseOtpAuthUri(buildOtpAuthUri(parsed))).toEqual(parsed);
  });

  it('escreve o rótulo do jeito da wiki do Google, separador cru e @ visível', () => {
    const parsed = parseOtpAuthUri(GITHUB);
    if (parsed === null) throw new Error('o exemplo da wiki deveria ter parseado');
    const uri = buildOtpAuthUri(parsed);
    expect(uri.startsWith('otpauth://totp/GitHub:alice@github.com?')).toBe(true);
    expect(uri).toContain(`secret=${STRONG_SECRET}`);
    // os parâmetros que a wiki deixa de fora por serem padrão saem explícitos:
    // é o mesmo token e o outro autenticator não precisa adivinhar
    expect(uri).toContain('&algorithm=SHA1&digits=6&period=30');
  });

  it('sobrevive a conta e emissor com acento ou espaço', () => {
    const uri = buildOtpAuthUri({
      issuer: 'Banco do Brasil',
      account: 'joão.silva@exemplo.com.br',
      algorithm: 'SHA256',
      digits: 8,
      period: 60,
      secret: STRONG_SECRET,
    });
    expect(parseOtpAuthUri(uri)).toEqual({
      issuer: 'Banco do Brasil',
      account: 'joão.silva@exemplo.com.br',
      algorithm: 'SHA256',
      digits: 8,
      period: 60,
      secret: STRONG_SECRET,
    });
  });

  it('mantém o segredo fora do rótulo, só nos parâmetros', () => {
    const uri = buildOtpAuthUri({
      issuer: 'GitHub',
      account: 'alice',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: STRONG_SECRET,
    });
    expect(uri).toContain(`secret=${STRONG_SECRET}`);
    expect(uri.indexOf(STRONG_SECRET)).toBeGreaterThan(uri.indexOf('?'));
  });
});
